PromptVault corrected files
============================

Files:
- index.html: page structure and restrictive meta Content Security Policy.
- style.css: responsive visual design.
- app.js: safe rendering, search, filters, sort, grid/list, prompt details, and copy button.

Install:
1. Put index.html, style.css, and app.js in the repository root.
2. Keep lebanon_ai_1000_image_prompts_with_previews.json in the same root.
3. Keep preview files in ./previews/ named 0001.webp, 0002.webp, etc. The script also tries png/jpg/jpeg.
4. Test through a local web server or GitHub Pages. Fetching JSON may not work if opening index.html directly as file://.

Security notes:
- Prompt text and tags are inserted using textContent / DOM nodes, not innerHTML.
- Image URLs are generated from numeric IDs and fixed local paths; arbitrary image URLs from JSON are not accepted.
- No API keys or secrets are required for this static site.
- The meta CSP is defense-in-depth, not a replacement for server-sent security headers. GitHub Pages does not let you configure every response header from HTML.
- Static sites can still be changed if an attacker gains write access to the repository or account. Enable GitHub 2FA, protect the account, and avoid broad-scope tokens.
- app.js expects the JSON to be an array (or {"prompts": [...]}) of objects with: id (number), title, prompt (required), category, tags[]. Test against your real JSON file before publishing.
- img-src 'self' (CSP) means previews must be hosted locally in ./previews/; external image URLs (e.g. Unsplash) will be blocked by design.
- No browser favicon is provided (a 404 for /favicon.ico is harmless); add a local favicon.ico or .svg file if desired.
- Real security headers (HSTS, X-Content-Type-Options, frame-ancestors) must be set by the host; they cannot be set from HTML.
- The "Only with preview" filter treats a numeric prompt ID as having a preview until its image fails to load; if your library has missing preview images, this can be refined by adding an explicit preview field to the JSON.
