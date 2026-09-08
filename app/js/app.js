/**
 * Schem Bench - UI.
 *
 * Flow: open a .mcworld (or a bare .mcstructure) -> pick a structure -> tick
 * off the blocks you do not want -> save. Everything runs in the page; no file
 * is uploaded anywhere, which is also why it works with the phone offline.
 */

import { McStructure, listStructures } from "./mcstructure.js";
import { blockColor, CATEGORY } from "./blocks.js";
import { Hologram } from "./viewer.js";

const $ = (id) => document.getElementById(id);

const ui = {
  worldInput: $("worldInput"),
  structureList: $("structureList"),
  structureTally: $("structureTally"),
  blockList: $("blockList"),
  blockTally: $("blockTally"),
  quick: $("quickActions"),
  exportPanel: $("exportPanel"),
  exportBtn: $("exportBtn"),
  exportResult: $("exportResult"),
  optCrop: $("optCrop"),
  optEntities: $("optEntities"),
  stageEmpty: $("stageEmpty"),
  stageHud: $("stageHud"),
  stageTools: $("stageTools"),
  hudName: $("hudName"),
  hudSize: $("hudSize"),
  hudKept: $("hudKept"),
  hudCut: $("hudCut"),
  toggleGhosts: $("toggleGhosts"),
  recenter: $("recenter"),
  toast: $("toast"),
  tabs: $("tabs")
};

const state = {
  sourceName: "world",
  entries: [],      // { path, name, namespace, entry }
  current: null,    // McStructure
  currentEntry: null,
  removed: new Set(),
  analysis: []
};

let holo = null;

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

function boot() {
  const canvas = $("stage");
  if (window.THREE) {
    holo = new Hologram(canvas);
    const ro = new ResizeObserver(() => holo.resize());
    ro.observe(canvas.parentElement);
  } else {
    ui.stageEmpty.textContent = "3D view unavailable offline on first run";
  }

  ui.worldInput.addEventListener("change", onFilePicked);
  ui.exportBtn.addEventListener("click", onExport);
  ui.quick.addEventListener("click", onQuickAction);
  ui.tabs.addEventListener("click", onTab);

  ui.toggleGhosts.addEventListener("click", () => {
    const on = ui.toggleGhosts.getAttribute("aria-pressed") !== "true";
    ui.toggleGhosts.setAttribute("aria-pressed", String(on));
    if (holo?.ghost) {
      holo.ghost.visible = on;
      holo.needsRender = true;
    }
  });

  ui.recenter.addEventListener("click", () => {
    if (holo && state.current) holo.frame(state.current.size);
  });

  for (const el of [ui.optCrop, ui.optEntities]) {
    el.addEventListener("change", () => {
      ui.exportResult.hidden = true;
      refreshHud();
    });
  }

  showPanel("structures");

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {
      /* offline support is a bonus, not a requirement */
    });
  }
}

/* ------------------------------------------------------------------ *
 * Loading
 * ------------------------------------------------------------------ */

async function onFilePicked(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  ui.worldInput.value = "";

  try {
    if (file.name.toLowerCase().endsWith(".mcstructure")) {
      await loadSingle(file);
    } else {
      await loadArchive(file);
    }
  } catch (err) {
    toast(err.message ?? String(err), true);
  }
}

async function loadSingle(file) {
  const buffer = await file.arrayBuffer();
  state.sourceName = file.name.replace(/\.mcstructure$/i, "");
  state.entries = [
    {
      path: file.name,
      namespace: "mystructure",
      name: state.sourceName,
      buffer
    }
  ];
  renderStructureList();
  selectStructure(0);
}

async function loadArchive(file) {
  if (typeof JSZip === "undefined") {
    throw new Error("The archive reader did not load. Reload the page and try again.");
  }
  toast(`Reading ${file.name}…`);
  const zip = await JSZip.loadAsync(file);
  const found = await listStructures(zip);

  if (!found.length) {
    throw new Error(
      "No .mcstructure files in there. Save a build with the Schem Table first, then export the world."
    );
  }

  state.sourceName = file.name.replace(/\.(mcworld|mcpack|mcaddon|zip)$/i, "");
  state.entries = found;
  renderStructureList();
  toast(`Found ${found.length} structure${found.length === 1 ? "" : "s"}`);
  await selectStructure(0);
}

function renderStructureList() {
  ui.structureList.innerHTML = "";
  ui.structureTally.textContent =
    state.entries.length === 1 ? "1 found" : `${state.entries.length} found`;

  state.entries.forEach((entry, index) => {
    const btn = document.createElement("button");
    btn.className = "item";
    btn.type = "button";
    btn.dataset.index = String(index);
    btn.innerHTML = `
      <span class="item-dot"></span>
      <span class="item-text">
        <span class="item-name"></span>
        <span class="item-meta"></span>
      </span>`;
    btn.querySelector(".item-name").textContent = entry.name;
    btn.querySelector(".item-meta").textContent = entry.namespace;
    btn.addEventListener("click", () => selectStructure(index));
    ui.structureList.appendChild(btn);
  });
}

async function selectStructure(index) {
  const entry = state.entries[index];
  if (!entry) return;

  for (const el of ui.structureList.querySelectorAll(".item")) {
    el.classList.toggle("is-on", el.dataset.index === String(index));
  }

  try {
    const buffer = entry.buffer ?? (await entry.entry.async("arraybuffer"));
    state.current = new McStructure(buffer);
    state.currentEntry = entry;
    state.removed = state.current.defaultRemovals();
    state.analysis = state.current.analyze();

    renderBlockList();
    renderHologram();
    ui.exportResult.hidden = true;
    ui.exportPanel.hidden = false;
    ui.quick.hidden = false;
    ui.stageEmpty.hidden = true;
    ui.stageHud.hidden = false;
    ui.stageTools.hidden = false;
    refreshHud();
  } catch (err) {
    toast(`${entry.name}: ${err.message ?? err}`, true);
  }
}

/* ------------------------------------------------------------------ *
 * Block list
 * ------------------------------------------------------------------ */

const CATEGORY_LABEL = {
  [CATEGORY.AIR]: "air",
  [CATEGORY.TERRAIN]: "terrain",
  [CATEGORY.PLANT]: "plant",
  [CATEGORY.FLUID]: "fluid",
  [CATEGORY.BUILD]: "build"
};

function renderBlockList() {
  ui.blockList.innerHTML = "";
  ui.blockList.classList.remove("rail-body--empty");

  for (const block of state.analysis) {
    const row = document.createElement("div");
    row.className = "brow";
    row.dataset.index = String(block.index);
    row.setAttribute("role", "checkbox");
    row.tabIndex = 0;

    const short = block.name.replace(/^minecraft:/, "");
    row.innerHTML = `
      <span class="swatch"></span>
      <span class="brow-text">
        <span class="brow-name"></span>
        <span class="brow-cat"></span>
      </span>
      <span class="brow-count"></span>
      <span class="brow-state"></span>`;

    row.querySelector(".swatch").style.background =
      "#" + blockColor(block.name).toString(16).padStart(6, "0");
    row.querySelector(".brow-name").textContent = short;
    row.querySelector(".brow-cat").textContent = CATEGORY_LABEL[block.category];
    row.querySelector(".brow-count").textContent = block.count.toLocaleString();

    const toggle = () => setRemoved(block.index, !state.removed.has(block.index));
    row.addEventListener("click", toggle);
    row.addEventListener("keydown", (e) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        toggle();
      }
    });

    ui.blockList.appendChild(row);
    paintRow(row, block.index);
  }
  refreshBlockTally();
}

function paintRow(row, index) {
  const cut = state.removed.has(index);
  row.classList.toggle("is-cut", cut);
  row.setAttribute("aria-checked", String(!cut));
  row.querySelector(".brow-state").textContent = cut ? "cut" : "keep";
}

function setRemoved(index, cut) {
  if (cut) state.removed.add(index);
  else state.removed.delete(index);

  const row = ui.blockList.querySelector(`.brow[data-index="${index}"]`);
  if (row) paintRow(row, index);

  refreshBlockTally();
  renderHologram();
  refreshHud();
  ui.exportResult.hidden = true;
}

function refreshBlockTally() {
  const total = state.analysis.length;
  const cut = state.analysis.filter((b) => state.removed.has(b.index)).length;
  ui.blockTally.textContent = `${total - cut}/${total} kept`;
}

function onQuickAction(event) {
  const action = event.target.closest("[data-quick]")?.dataset.quick;
  if (!action || !state.current) return;

  if (action === "clutter") state.removed = state.current.defaultRemovals(false);
  else if (action === "rock") state.removed = state.current.defaultRemovals(true);
  else if (action === "none") state.removed = new Set();
  else if (action === "invert") {
    const next = new Set();
    for (const block of state.analysis) {
      if (!state.removed.has(block.index)) next.add(block.index);
    }
    state.removed = next;
  }

  for (const row of ui.blockList.querySelectorAll(".brow")) {
    paintRow(row, Number(row.dataset.index));
  }
  refreshBlockTally();
  renderHologram();
  refreshHud();
  ui.exportResult.hidden = true;
}

/* ------------------------------------------------------------------ *
 * Hologram + readout
 * ------------------------------------------------------------------ */

const MAX_CELLS = 160000;

function renderHologram() {
  if (!holo || !state.current) return;
  let cells = state.current.visibleCells(state.removed);

  if (cells.length > MAX_CELLS) {
    cells = cells.slice(0, MAX_CELLS);
    toast(`Preview capped at ${MAX_CELLS.toLocaleString()} blocks. The export is not capped.`);
  }

  holo.setCells(cells, state.current.size);
  const ghostsOn = ui.toggleGhosts.getAttribute("aria-pressed") === "true";
  if (holo.ghost) holo.ghost.visible = ghostsOn;
}

function refreshHud() {
  if (!state.current) return;
  const s = state.current;
  ui.hudName.textContent = state.currentEntry?.name ?? "structure";

  let kept = 0;
  let cut = 0;
  for (const block of state.analysis) {
    if (block.category === CATEGORY.AIR) continue;
    if (state.removed.has(block.index)) cut += block.count;
    else kept += block.count;
  }

  ui.hudSize.textContent = `${s.size[0]}×${s.size[1]}×${s.size[2]}`;
  ui.hudKept.textContent = `${kept.toLocaleString()} kept`;
  ui.hudCut.textContent = `${cut.toLocaleString()} cut`;
}

/* ------------------------------------------------------------------ *
 * Export
 * ------------------------------------------------------------------ */

function onExport() {
  if (!state.current) return;

  let result;
  try {
    result = state.current.export(state.removed, {
      crop: ui.optCrop.checked,
      keepEntities: ui.optEntities.checked
    });
  } catch (err) {
    showResult(err.message ?? String(err), true);
    return;
  }

  const name = `${sanitize(state.currentEntry?.name ?? "structure")}.mcstructure`;
  download(new Blob([result.buffer], { type: "application/octet-stream" }), name);

  const [ox, oy, oz] = result.trimmed.from;
  const [nx, ny, nz] = result.size;
  const shrank = ox !== nx || oy !== ny || oz !== nz;
  showResult(
    [
      `Saved ${name}`,
      `${result.blockCount.toLocaleString()} blocks, ${result.paletteSize} block types`,
      shrank
        ? `Trimmed ${ox}×${oy}×${oz} → ${nx}×${ny}×${nz}`
        : `Size ${nx}×${ny}×${nz}`
    ].join("\n"),
    false
  );
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function sanitize(name) {
  return name.replace(/[^a-zA-Z0-9_\-.]/g, "_").slice(0, 60) || "structure";
}

function showResult(text, bad) {
  ui.exportResult.textContent = text;
  ui.exportResult.classList.toggle("is-bad", !!bad);
  ui.exportResult.hidden = false;
}

/* ------------------------------------------------------------------ *
 * Chrome
 * ------------------------------------------------------------------ */

function onTab(event) {
  const tab = event.target.closest("[data-tab]");
  if (tab) showPanel(tab.dataset.tab);
}

function showPanel(which) {
  for (const el of document.querySelectorAll("[data-panel]")) {
    el.classList.toggle("is-shown", el.dataset.panel === which);
  }
  for (const el of ui.tabs.querySelectorAll(".tab")) {
    el.classList.toggle("is-on", el.dataset.tab === which);
  }
  if (which === "view" && holo) requestAnimationFrame(() => holo.resize());
}

let toastTimer = null;
function toast(message, bad = false) {
  ui.toast.textContent = message;
  ui.toast.classList.toggle("is-bad", bad);
  ui.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    ui.toast.hidden = true;
  }, bad ? 6000 : 2800);
}

boot();
