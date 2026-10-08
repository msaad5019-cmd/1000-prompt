
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
generate_previews.py

Generates ONE preview image per prompt using Cloudflare Workers AI (FLUX.1 schnell),
saves it in ./previews/ and writes the path into the JSON as "preview_image".

- Free tier: stops cleanly when the daily quota is used up; run it again the next day.
- Resumable: images that already exist are skipped.
- Original JSON is backed up once as <file>.bak before the first write.

.env must contain:
    CF_ACCOUNT_ID=your_account_id
    CF_API_TOKEN=your_api_token

Usage:
    python3 generate_previews.py --limit 4      # test with 4 prompts
    python3 generate_previews.py                # all prompts (stops at daily quota)

Optional: pip3 install pillow   (converts images to small .webp files)
Compatible with Python 3.8.
"""

import argparse
import base64
import io
import json
import os
import re
import shutil
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests
from dotenv import load_dotenv

load_dotenv(".env")

PROMPTS_FILE = "lebanon_ai_1000_image_prompts_with_previews.json"
PREVIEWS_DIR = "previews"
MODEL = "@cf/black-forest-labs/flux-1-schnell"
API_URL = "https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/" + MODEL

CF_ACCOUNT_ID = (os.getenv("CF_ACCOUNT_ID") or "").strip().strip('"').strip("'")
CF_API_TOKEN = (os.getenv("CF_API_TOKEN") or "").strip().strip('"').strip("'")

STEPS = 4              # FLUX schnell is built for few steps (max 8)
REQUEST_DELAY = 1.0    # seconds between requests
REQUEST_TIMEOUT = 120
MAX_RETRIES = 2
MAX_PROMPT_CHARS = 1800
MAX_IMAGE_SIDE = 768   # saved preview size (needs Pillow)

PLACEHOLDER_RE = re.compile(r"\$\{\s*([^:{}]*?)\s*:\s*([^{}]*?)\s*\}")
PLACEHOLDER_NOLABEL_RE = re.compile(r"\$\{\s*([^:{}]*?)\s*\}")
ARGUMENT_RE = re.compile(
    r"""\{\s*argument\s+name\s*=\s*["']([^"']*)["']\s+default\s*=\s*["']([^"']*)["']\s*\}""",
    re.I,
)
INPUT_IMAGE_RE = re.compile(
    r"uploaded|source image|provided image|attached image|reference image|input image|"
    r"based on the (?:photo|image)",
    re.I,
)
QUOTA_RE = re.compile(r"4006|daily free allocation|used up", re.I)


class QuotaExceeded(Exception):
    """Daily free allocation is finished."""


class FatalError(Exception):
    """Wrong credentials or permissions - no point in continuing."""


def clean_prompt(raw: str) -> str:
    text = ARGUMENT_RE.sub(lambda m: m.group(2), raw or "")
    text = PLACEHOLDER_RE.sub(lambda m: m.group(2), text)
    text = PLACEHOLDER_NOLABEL_RE.sub(lambda m: m.group(1), text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:MAX_PROMPT_CHARS]


def call_flux(prompt: str) -> bytes:
    url = API_URL.format(account=CF_ACCOUNT_ID)
    headers = {"Authorization": "Bearer " + CF_API_TOKEN}
    resp = requests.post(
        url, headers=headers, json={"prompt": prompt, "steps": STEPS}, timeout=REQUEST_TIMEOUT
    )
    ctype = resp.headers.get("Content-Type", "")

    if resp.status_code in (401, 403):
        raise FatalError("HTTP " + str(resp.status_code) + " - check CF_ACCOUNT_ID / CF_API_TOKEN permissions")
    if resp.status_code == 429 or (resp.status_code >= 400 and QUOTA_RE.search(resp.text)):
        raise QuotaExceeded()
    if resp.status_code >= 400:
        raise RuntimeError("HTTP " + str(resp.status_code) + ": " + resp.text[:300])

    if ctype.startswith("image/"):
        return resp.content
    data = resp.json()
    image_b64 = (data.get("result") or {}).get("image")
    if not image_b64:
        raise RuntimeError("no image in response: " + json.dumps(data)[:300])
    return base64.b64decode(image_b64)


def save_image(raw: bytes, base_path: Path) -> Path:
    """Save as small .webp when Pillow is installed, otherwise as the original .jpg."""
    try:
        from PIL import Image  # type: ignore
    except ImportError:
        out = base_path.with_suffix(".jpg")
        out.write_bytes(raw)
        return out
    try:
        img = Image.open(io.BytesIO(raw)).convert("RGB")
        img.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE))
        out = base_path.with_suffix(".webp")
        img.save(str(out), "WEBP", quality=82)
        return out
    except Exception:
        out = base_path.with_suffix(".jpg")
        out.write_bytes(raw)
        return out


def existing_preview(base_path: Path) -> Optional[Path]:
    for ext in (".webp", ".jpg"):
        p = base_path.with_suffix(ext)
        if p.is_file() and p.stat().st_size > 0:
            return p
    return None


def save_json(path: Path, data: List[Dict[str, Any]]) -> None:
    tmp = path.with_suffix(".tmp")
    with open(str(tmp), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(str(tmp), str(path))


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate preview images with Cloudflare Workers AI")
    parser.add_argument("--limit", type=int, default=0, help="only process the first N prompts (0 = all)")
    parser.add_argument("--file", default=PROMPTS_FILE, help="prompts JSON file")
    args = parser.parse_args()

    if not CF_ACCOUNT_ID or not CF_API_TOKEN:
        print("ERROR: add these two lines to your .env file:")
        print("       CF_ACCOUNT_ID=your_account_id")
        print("       CF_API_TOKEN=your_api_token")
        return 1

    json_path = Path(args.file)
    if not json_path.is_file():
        print("ERROR: cannot find " + args.file + " in " + str(Path.cwd()))
        return 1

    with open(str(json_path), "r", encoding="utf-8-sig") as f:
        items = json.load(f)
    if not isinstance(items, list):
        print("ERROR: the JSON file must be an array of prompt objects")
        return 1

    backup = Path(str(json_path) + ".bak")
    if not backup.exists():
        shutil.copyfile(str(json_path), str(backup))

    out_dir = Path(PREVIEWS_DIR)
    out_dir.mkdir(exist_ok=True)

    todo = items[: args.limit] if args.limit and args.limit > 0 else items
    generated = skipped = failed = 0

    print("Model: " + MODEL + " | prompts: " + str(len(todo)) + " | folder: " + PREVIEWS_DIR + "/")
    try:
        for index, item in enumerate(todo, 1):
            if not isinstance(item, dict) or not item.get("prompt"):
                continue
            item_id = item.get("id", index)
            try:
                name = "{:04d}".format(int(item_id))
            except (TypeError, ValueError):
                name = "item_" + str(index)
            base = out_dir / name

            found = existing_preview(base)
            if found is not None:
                item["preview_image"] = PREVIEWS_DIR + "/" + found.name
                skipped += 1
                continue

            prompt = clean_prompt(str(item["prompt"]))
            raw = None  # type: Optional[bytes]
            last_error = ""
            for attempt in range(MAX_RETRIES + 1):
                try:
                    raw = call_flux(prompt)
                    break
                except (requests.RequestException, RuntimeError, ValueError) as exc:
                    last_error = str(exc)
                    time.sleep(2 * (attempt + 1))

            if raw is None:
                failed += 1
                print("[" + str(index) + "/" + str(len(todo)) + "] id=" + str(item_id) + " FAILED: " + last_error[:150])
                continue

            saved = save_image(raw, base)
            item["preview_image"] = PREVIEWS_DIR + "/" + saved.name
            if INPUT_IMAGE_RE.search(str(item["prompt"])):
                item["preview_note"] = "generated from text only (prompt mentions an input image)"
            generated += 1
            save_json(json_path, items)
            print("[" + str(index) + "/" + str(len(todo)) + "] id=" + str(item_id) + " OK -> " + item["preview_image"])
            time.sleep(REQUEST_DELAY)

    except QuotaExceeded:
        print("")
        print("Daily free quota is finished. Run the same command again after 00:00 UTC.")
    except FatalError as exc:
        print("")
        print("STOPPED: " + str(exc))
        save_json(json_path, items)
        return 2
    except KeyboardInterrupt:
        print("")
        print("Interrupted - progress is saved.")

    save_json(json_path, items)
    print("")
    print("Generated: " + str(generated) + " | already existed: " + str(skipped) + " | failed: " + str(failed))
    return 0


if __name__ == "__main__":
    sys.exit(main())
EOF
