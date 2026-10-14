(() => {
  "use strict";

  const DATA_URL = "./lebanon_ai_1000_image_prompts_with_previews.json";
  const PAGE_SIZE = 24;
  const MAX_PROMPTS = 20000;
  const MAX_TEXT_LENGTH = 20000;
  const state = { all: [], filtered: [], shown: 0, currentList: [], currentIndex: -1, view: "grid" };

  const $ = (id) => document.getElementById(id);
  const els = {
    q: $("q"), cat: $("cat"), sort: $("sort"), onlyPrev: $("onlyPrev"),
    grid: $("grid"), count: $("count"), more: $("more"), status: $("status"),
    statTotal: $("statTotal"), statPrev: $("statPrev"), statCat: $("statCat"),
    vGrid: $("vGrid"), vList: $("vList"), toast: $("toast"),
    dlg: $("dlg"), dTitle: $("dTitle"), dClose: $("dClose"), dImg: $("dImg"),
    dCat: $("dCat"), dId: $("dId"), dPrompt: $("dPrompt"), dTags: $("dTags"),
    dPrev: $("dPrev"), dNext: $("dNext"), dCopy: $("dCopy")
  };

  function text(value, max = MAX_TEXT_LENGTH) {
    if (typeof value === "string") return value.slice(0, max);
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    return "";
  }

  function safeId(value, fallback) {
    const n = Number(value);
    return Number.isSafeInteger(n) && n >= 0 ? n : fallback;
  }

  function normalizePrompt(item, index) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const id = safeId(item.id, index + 1);
    const title = text(item.title, 180).trim() || `Untitled prompt ${id}`;
    const prompt = text(item.prompt).trim();
    if (!prompt) return null;

    const rawTags = Array.isArray(item.tags) ? item.tags : [];
    const tags = rawTags.slice(0, 30).map((tag) => text(tag, 80).trim()).filter(Boolean);
    const category = text(item.category, 100).trim() || "Uncategorized";
    return { id, title, prompt, category, tags, index };
  }

  function imagePath(id, extension = "webp") {
    // IDs are numeric, so user-provided JSON cannot inject a URL or path.
    return `./previews/${String(id).padStart(4, "0")}.${extension}`;
  }

  function setLocalImage(img, id, onSuccess, onFailure) {
    const extensions = ["webp", "png", "jpg", "jpeg"];
    let attempt = 0;
    img.onerror = () => {
      attempt += 1;
      if (attempt < extensions.length) img.src = imagePath(id, extensions[attempt]);
      else {
        img.onerror = null;
        img.removeAttribute("src");
        if (onFailure) onFailure();
      }
    };
    img.onload = () => { if (onSuccess) onSuccess(); };
    img.src = imagePath(id, extensions[0]);
  }

  function makeTag(label, className = "tag") {
    const span = document.createElement("span");
    span.className = className;
    span.textContent = label;
    return span;
  }

  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("show");
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => els.toast.classList.remove("show"), 2200);
  }

  async function copyText(value) {
    const content = text(value);
    if (!content) { toast("There is no prompt text to copy."); return; }
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(content);
      } else {
        const area = document.createElement("textarea");
        area.value = content;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        const copied = document.execCommand("copy");
        area.remove();
        if (!copied) throw new Error("Clipboard copy was blocked");
      }
      toast("Prompt copied to clipboard.");
    } catch {
      toast("Copy was blocked by your browser. Select and copy the prompt manually.");
    }
  }

  function renderCard(item) {
    const article = document.createElement("article");
    article.className = "card";

    const thumb = document.createElement("button");
    thumb.type = "button";
    thumb.className = "thumb";
    thumb.setAttribute("aria-label", `Open prompt: ${item.title}`);

    const placeholder = document.createElement("span");
    placeholder.className = "ph";
    placeholder.textContent = "Preview unavailable";
    thumb.appendChild(placeholder);

    const img = document.createElement("img");
    img.alt = `Preview for ${item.title}`;
    img.loading = "lazy";
    img.decoding = "async";
    setLocalImage(img, item.id, () => {
      placeholder.hidden = true;
      thumb.classList.add("loaded");
    }, () => {
      thumb.classList.add("noimg");
      placeholder.hidden = false;
    });
    thumb.appendChild(img);
    thumb.addEventListener("click", () => openDialog(item));
    article.appendChild(thumb);

    const content = document.createElement("div");
    content.className = "card-content";

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.appendChild(makeTag(item.category, "category"));
    const pid = document.createElement("span");
    pid.className = "pid";
    pid.textContent = `#${item.id}`;
    meta.appendChild(pid);
    content.appendChild(meta);

    const title = document.createElement("h3");
    title.textContent = item.title;
    content.appendChild(title);

    const excerpt = document.createElement("p");
    excerpt.className = "excerpt";
    excerpt.textContent = item.prompt;
    content.appendChild(excerpt);

    const tags = document.createElement("div");
    tags.className = "tags";
    item.tags.slice(0, 5).forEach((tag) => tags.appendChild(makeTag(tag)));
    content.appendChild(tags);

    const actions = document.createElement("div");
    actions.className = "actions";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "primary";
    copy.textContent = "Copy prompt";
    copy.addEventListener("click", () => copyText(item.prompt));
    const details = document.createElement("button");
    details.type = "button";
    details.className = "ghost";
    details.textContent = "Details";
    details.addEventListener("click", () => openDialog(item));
    actions.append(copy, details);
    content.appendChild(actions);
    article.appendChild(content);
    return article;
  }

  function showEmpty(title, message) {
    const box = document.createElement("div");
    box.className = "empty";
    const strong = document.createElement("strong");
    strong.textContent = title;
    const p = document.createElement("p");
    p.textContent = message;
    box.append(strong, p);
    els.grid.appendChild(box);
  }

  function getFiltered() {
    const query = els.q.value.trim().toLocaleLowerCase().slice(0, 100);
    const category = els.cat.value;
    let list = state.all.filter((item) => {
      if (category && item.category !== category) return false;
      if (els.onlyPrev.checked && !item.hasPreview) return false;
      if (!query) return true;
      const haystack = [item.title, item.prompt, item.category, ...item.tags].join(" ").toLocaleLowerCase();
      return haystack.includes(query);
    });

    if (els.sort.value === "title") list.sort((a, b) => a.title.localeCompare(b.title));
    else if (els.sort.value === "newest") list.sort((a, b) => b.id - a.id);
    else list.sort((a, b) => a.index - b.index);
    return list;
  }

  function render(reset = true) {
    if (reset) {
      state.filtered = getFiltered();
      state.shown = 0;
      els.grid.replaceChildren();
    }
    const total = state.filtered.length;
    const next = state.filtered.slice(state.shown, state.shown + PAGE_SIZE);
    const fragment = document.createDocumentFragment();
    next.forEach((item) => fragment.appendChild(renderCard(item)));
    els.grid.appendChild(fragment);
    state.shown += next.length;

    els.count.textContent = total ? `${Math.min(state.shown, total).toLocaleString()} of ${total.toLocaleString()} prompts` : "0 prompts";
    els.more.hidden = state.shown >= total;
    if (reset && total === 0) showEmpty("No prompts found", "Try another search term or change your filters.");
  }

  function setView(view) {
    state.view = view;
    els.grid.classList.toggle("list", view === "list");
    els.vGrid.classList.toggle("active", view === "grid");
    els.vList.classList.toggle("active", view === "list");
    els.vGrid.setAttribute("aria-pressed", String(view === "grid"));
    els.vList.setAttribute("aria-pressed", String(view === "list"));
  }

  function openDialog(item) {
    state.currentList = state.filtered;
    const index = state.currentList.indexOf(item);
    if (index < 0) return;
    state.currentIndex = index;
    updateDialog();
    if (typeof els.dlg.showModal === "function") els.dlg.showModal();
    else els.dlg.setAttribute("open", "");
  }

  function updateDialog() {
    const item = state.currentList[state.currentIndex];
    if (!item) return;
    els.dTitle.textContent = item.title;
    els.dCat.textContent = item.category;
    els.dId.textContent = `#${item.id}`;
    els.dPrompt.textContent = item.prompt;
    els.dTags.replaceChildren(...item.tags.map((tag) => makeTag(tag)));
    els.dImg.hidden = true;
    els.dImg.alt = `Preview for ${item.title}`;
    setLocalImage(els.dImg, item.id, () => { els.dImg.hidden = false; }, () => { els.dImg.hidden = true; });
    els.dPrev.disabled = state.currentIndex <= 0;
    els.dNext.disabled = state.currentIndex >= state.currentList.length - 1;
  }

  function changeDialog(step) {
    const next = state.currentIndex + step;
    if (next < 0 || next >= state.currentList.length) return;
    state.currentIndex = next;
    updateDialog();
  }

  function populateCategories() {
    const categories = [...new Set(state.all.map((item) => item.category))].sort((a, b) => a.localeCompare(b));
    const fragment = document.createDocumentFragment();
    categories.forEach((category) => {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = category;
      fragment.appendChild(option);
    });
    els.cat.appendChild(fragment);
    els.statCat.textContent = categories.length.toLocaleString();
  }

  async function init() {
    try {
      const response = await fetch(DATA_URL, { credentials: "same-origin", cache: "no-cache" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const source = Array.isArray(data) ? data : (data && Array.isArray(data.prompts) ? data.prompts : null);
      if (!source) throw new Error("The JSON file must contain an array of prompts.");
      if (source.length > MAX_PROMPTS) throw new Error(`Library exceeds the configured limit of ${MAX_PROMPTS} prompts.`);

      state.all = source.map(normalizePrompt).filter(Boolean);
      // Preview paths are derived only from numeric IDs; JSON cannot specify arbitrary external URLs.
      state.all.forEach((item) => { item.hasPreview = true; });
      if (!state.all.length) throw new Error("No valid prompt records were found.");

      populateCategories();
      els.statTotal.textContent = state.all.length.toLocaleString();
      els.statPrev.textContent = state.all.length.toLocaleString();
      els.status.textContent = "Library loaded";
      render();
    } catch (error) {
      console.error("Prompt library failed to load:", error);
      els.grid.replaceChildren();
      showEmpty("Library could not be loaded", "Check that the JSON file exists in the repository root and contains valid prompt data.");
      els.count.textContent = "Unable to load prompts";
      els.status.textContent = "Load error";
    }
  }

  [els.q, els.cat, els.sort, els.onlyPrev].forEach((control) => {
    control.addEventListener(control === els.q ? "input" : "change", () => render());
  });
  els.vGrid.addEventListener("click", () => setView("grid"));
  els.vList.addEventListener("click", () => setView("list"));
  els.more.addEventListener("click", () => render(false));
  els.dClose.addEventListener("click", () => els.dlg.close());
  els.dPrev.addEventListener("click", () => changeDialog(-1));
  els.dNext.addEventListener("click", () => changeDialog(1));
  els.dCopy.addEventListener("click", () => copyText(els.dPrompt.textContent));
  els.dlg.addEventListener("click", (event) => {
    if (event.target === els.dlg) els.dlg.close();
  });
  document.addEventListener("keydown", (event) => {
    if (!els.dlg.open) return;
    if (event.key === "ArrowLeft") changeDialog(-1);
    if (event.key === "ArrowRight") changeDialog(1);
  });

  init();
})();