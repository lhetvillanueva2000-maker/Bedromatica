/**
 * Schem Bench - UI.
 *
 * Open a world container, see every build inside it at once, pick one, tick off
 * the blocks you do not want, save it. Everything runs in the page; no file is
 * uploaded anywhere, which is also why it works with the phone offline.
 */

import { McStructure, listStructures } from "./mcstructure.js";
import { blockColor, CATEGORY, isModded, namespaceOf } from "./blocks.js";
import { Hologram } from "./viewer.js";
import { readEntities, summarise, keepableTags } from "./entities.js";
import { identify, removalsFor, PRESET_LABEL, KNOWLEDGE_SIZE, KEYWORD_COUNT } from "./assistant.js";
import { RedstoneWorld, isLever, key as cellKey } from "./redstone.js";

const $ = (id) => document.getElementById(id);

const ui = {};
for (const id of [
  "worldInput", "structureList", "structureTally", "blockList", "blockTally",
  "quickActions", "exportPanel", "exportBtn", "exportResult", "optCrop",
  "optEntities", "stageEmpty", "stageHud", "stageTools", "stageHint",
  "hudName", "hudSize", "hudKept", "hudCut", "hudPick",
  "toggleGhosts", "toggleEntities", "recenter", "toast", "tabs",
  "assistantCard", "assistType", "assistAdvice", "assistConfidence", "assistApply",
  "toolCards", "selectionCard", "selectionInfo", "selectionClear", "selCut", "selKeep",
  "leverCard", "leverTally", "leverInfo", "leversOn", "leversOff", "leverCaveat",
  "entityCard", "entityTally", "entityInfo", "supportFrame",
  "supportOpen", "supportBack"
]) ui[id] = $(id);

const state = {
  sourceName: "world",
  /** @type {Array<{entry, structure, removed:Set, excluded:Set, entities, analysis, assist}>} */
  loaded: [],
  active: -1,
  redstone: null,
  selection: null
};

let holo = null;

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

function boot() {
  const canvas = $("stage");
  if (window.THREE) {
    holo = new Hologram(canvas, {
      onTap: onPickBlock,
      onRegionEnd: onRegionEnd
    });
    new ResizeObserver(() => holo.resize()).observe(canvas.parentElement);
  } else {
    ui.stageEmpty.textContent = "3D view unavailable";
  }

  ui.worldInput.addEventListener("change", onFilePicked);
  ui.exportBtn.addEventListener("click", onExport);
  ui.quickActions.addEventListener("click", onQuickAction);
  ui.tabs.addEventListener("click", onTab);
  ui.assistApply.addEventListener("click", applyAssistant);
  ui.supportOpen.addEventListener("click", () => showPanel("support"));
  ui.supportBack.addEventListener("click", () => showPanel(lastPanel));

  ui.selectionClear.addEventListener("click", () => {
    holo?.clearSelection();
    state.selection = null;
    ui.selectionCard.hidden = true;
  });
  ui.selCut.addEventListener("click", () => applySelection("cut"));
  ui.selKeep.addEventListener("click", () => applySelection("keep"));

  ui.leversOn.addEventListener("click", () => setAllLevers(true));
  ui.leversOff.addEventListener("click", () => setAllLevers(false));

  ui.toggleGhosts.addEventListener("click", () => {
    const on = ui.toggleGhosts.getAttribute("aria-pressed") !== "true";
    ui.toggleGhosts.setAttribute("aria-pressed", String(on));
    if (holo?.ghost) {
      holo.ghost.visible = on;
      holo.needsRender = true;
    }
  });

  ui.toggleEntities.addEventListener("click", () => {
    const on = ui.toggleEntities.getAttribute("aria-pressed") !== "true";
    ui.toggleEntities.setAttribute("aria-pressed", String(on));
    if (holo?.entityGroup) {
      holo.entityGroup.visible = on;
      holo.needsRender = true;
    }
  });

  ui.recenter.addEventListener("click", () => holo?.recentre());

  for (const el of [ui.optCrop, ui.optEntities]) {
    el.addEventListener("change", () => {
      ui.exportResult.hidden = true;
    });
  }

  showPanel("structures");

  // The Android build already has every asset on disk, and a stale worker
  // cache there would survive app updates. Only the web build needs this.
  if ("serviceWorker" in navigator && !window.SchemBench) {
    navigator.serviceWorker.register("sw.js").catch(() => undefined);
  }
}

/* ------------------------------------------------------------------ *
 * Loading
 * ------------------------------------------------------------------ */

const NESTED_ARCHIVE = /\.(mcworld|mctemplate|mcpack|mcaddon|zip)$/i;

/**
 * Every Minecraft world container is a zip with a different extension on it.
 * Sniffing the first four bytes instead of trusting the name means a renamed
 * file, or one handed over by an Android picker that dropped the extension,
 * still opens.
 */
async function looksLikeZip(file) {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (head[0] !== 0x50 || head[1] !== 0x4b) return false;
  return (
    (head[2] === 0x03 && head[3] === 0x04) ||
    (head[2] === 0x05 && head[3] === 0x06) ||
    (head[2] === 0x07 && head[3] === 0x08)
  );
}

async function onFilePicked(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  ui.worldInput.value = "";
  try {
    const entries = (await looksLikeZip(file))
      ? await readArchive(file)
      : await readSingle(file);
    await loadAll(entries, file.name.replace(NESTED_ARCHIVE, "").replace(/\.mcstructure$/i, ""));
  } catch (err) {
    toast(err.message ?? String(err), true);
  }
}

async function readSingle(file) {
  return [
    {
      path: file.name,
      namespace: "mystructure",
      name: file.name.replace(/\.mcstructure$/i, ""),
      buffer: await file.arrayBuffer()
    }
  ];
}

async function readArchive(file) {
  if (typeof JSZip === "undefined") {
    throw new Error("The archive reader did not load. Reload and try again.");
  }
  toast(`Reading ${file.name}…`);

  const zip = await JSZip.loadAsync(file);
  const found = await listStructures(zip);

  // A plain .zip someone made by zipping their world folder - or by zipping
  // the .mcworld itself - is common enough to open one level down.
  const inner = [];
  zip.forEach((path, entry) => {
    if (!entry.dir && NESTED_ARCHIVE.test(path)) inner.push({ path, entry });
  });

  for (const nested of inner) {
    try {
      const sub = await JSZip.loadAsync(await nested.entry.async("arraybuffer"));
      const label = nested.path.split("/").pop().replace(NESTED_ARCHIVE, "");
      for (const item of await listStructures(sub)) {
        item.namespace = `${label} › ${item.namespace}`;
        found.push(item);
      }
    } catch {
      /* not a readable archive; the outer listing still stands */
    }
  }

  if (!found.length) {
    throw new Error(
      "No .mcstructure files in there. Save a build with the Schem Table first, then export the world."
    );
  }
  found.sort((a, b) => a.name.localeCompare(b.name));
  return found;
}

/** Parses every structure up front so the whole world can be drawn at once. */
async function loadAll(entries, sourceName) {
  state.sourceName = sourceName || "world";
  state.loaded = [];

  for (const entry of entries) {
    let structure;
    try {
      const buffer = entry.buffer ?? (await entry.entry.async("arraybuffer"));
      structure = new McStructure(buffer);
    } catch (err) {
      console.warn(`${entry.name}: ${err.message}`);
      continue;
    }

    const assist = identify(entry.name);
    const removed = assist
      ? removalsFor(structure, assist.preset)
      : structure.defaultRemovals(false);

    state.loaded.push({
      entry,
      structure,
      removed,
      excluded: new Set(),
      entities: readEntities(structure),
      analysis: structure.analyze(),
      assist
    });
  }

  if (!state.loaded.length) throw new Error("None of the structures could be read.");

  renderStructureList();
  setActive(0);
  toast(
    `${state.loaded.length} build${state.loaded.length === 1 ? "" : "s"} loaded` +
      ` · assistant knows ${KNOWLEDGE_SIZE} types from ${KEYWORD_COUNT} keywords`
  );
}

function renderStructureList() {
  ui.structureList.innerHTML = "";
  ui.structureTally.textContent = `${state.loaded.length} found`;

  state.loaded.forEach((item, index) => {
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
    btn.querySelector(".item-name").textContent = item.entry.name;
    const size = item.structure.size;
    btn.querySelector(".item-meta").textContent =
      `${size[0]}×${size[1]}×${size[2]}` +
      (item.assist ? ` · ${item.assist.type}` : "");
    btn.addEventListener("click", () => setActive(index));
    ui.structureList.appendChild(btn);
  });
}

/* ------------------------------------------------------------------ *
 * Active build
 * ------------------------------------------------------------------ */

function active() {
  return state.loaded[state.active] ?? null;
}

function setActive(index) {
  if (!state.loaded[index]) return;
  state.active = index;

  for (const el of ui.structureList.querySelectorAll(".item")) {
    el.classList.toggle("is-on", el.dataset.index === String(index));
  }

  renderBlockList();
  renderAssistant();
  renderEntities();
  rebuildScene();

  ui.exportResult.hidden = true;
  ui.exportPanel.hidden = false;
  ui.quickActions.hidden = false;
  ui.toolCards.hidden = false;
  ui.stageEmpty.hidden = true;
  ui.stageHud.hidden = false;
  ui.stageTools.hidden = false;
  ui.stageHint.hidden = false;
  refreshHud();
}

/* ------------------------------------------------------------------ *
 * Scene
 * ------------------------------------------------------------------ */

const MAX_CELLS = 180000;

/**
 * Builds one scene out of every loaded build, each placed at its real
 * structure_world_origin so the layout matches where things actually stood.
 */
function rebuildScene() {
  if (!holo) return;

  const cells = [];
  const entities = [];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let truncated = false;

  state.loaded.forEach((item, structureIndex) => {
    const origin = item.structure.origin;
    const local = item.structure.visibleCells(item.removed);

    for (const c of local) {
      if (cells.length >= MAX_CELLS) {
        truncated = true;
        break;
      }
      const x = origin[0] + c.x;
      const y = origin[1] + c.y;
      const z = origin[2] + c.z;
      cells.push({
        x, y, z,
        lx: c.x, ly: c.y, lz: c.z,
        name: c.name,
        palette: c.palette,
        kept: c.kept && !item.excluded.has(item.structure.indexOf(c.x, c.y, c.z)),
        structureIndex
      });
      if (x < min[0]) min[0] = x;
      if (y < min[1]) min[1] = y;
      if (z < min[2]) min[2] = z;
      if (x > max[0]) max[0] = x;
      if (y > max[1]) max[1] = y;
      if (z > max[2]) max[2] = z;
    }

    for (const e of item.entities.kept) {
      entities.push({
        ...e,
        x: origin[0] + e.x,
        y: origin[1] + e.y,
        z: origin[2] + e.z
      });
    }
  });

  if (!cells.length) {
    holo.setCells([], { min: [0, 0, 0], max: [1, 1, 1] }, []);
    return;
  }
  if (truncated) {
    toast(`Preview capped at ${MAX_CELLS.toLocaleString()} blocks. Exports are not capped.`);
  }

  holo.setCells(cells, { min, max }, entities);
  if (holo.ghost) {
    holo.ghost.visible = ui.toggleGhosts.getAttribute("aria-pressed") === "true";
  }
  if (holo.entityGroup) {
    holo.entityGroup.visible = ui.toggleEntities.getAttribute("aria-pressed") === "true";
  }

  buildRedstone(cells);
}

/* ------------------------------------------------------------------ *
 * Levers
 * ------------------------------------------------------------------ */

function buildRedstone(cells) {
  const item = active();
  if (!item) return;

  // Levers are simulated within the active build only - power does not jump
  // between separate captures that merely sit near each other.
  const local = cells
    .filter((c) => c.structureIndex === state.active)
    .map((c) => ({ x: c.lx, y: c.ly, z: c.lz, name: c.name }));

  state.redstone = new RedstoneWorld(local);
  const count = state.redstone.leverCount;

  ui.leverCard.hidden = count === 0;
  if (!count) return;

  ui.leverTally.textContent = `${count} found`;
  const unsimulated = state.redstone.unsimulated(local);
  if (unsimulated.length) {
    ui.leverCaveat.hidden = false;
    ui.leverCaveat.textContent =
      `Not simulated: ${unsimulated.join(", ")}. These light up when fed but do not pass signal on — ` +
      `repeaters and comparators need tick timing this does not model.`;
  } else {
    ui.leverCaveat.hidden = true;
  }
  solvePower();
}

function solvePower() {
  if (!state.redstone || !holo) return;
  const { powered, litConsumers } = state.redstone.solve();
  const lit = holo.setPowered(powered);
  const on = [...state.redstone.state.values()].filter(Boolean).length;
  ui.leverInfo.textContent =
    on === 0
      ? "All levers off. Tap a lever in the 3D view to flip it."
      : `${on} lever${on === 1 ? "" : "s"} on · ${lit} block${lit === 1 ? "" : "s"} powered · ${litConsumers} component${litConsumers === 1 ? "" : "s"} lit`;
}

function setAllLevers(on) {
  if (!state.redstone || !state.redstone.leverCount) return;
  state.redstone.setAll(on);
  solvePower();
}

/* ------------------------------------------------------------------ *
 * Picking
 * ------------------------------------------------------------------ */

function onPickBlock(cell) {
  if (!cell) {
    ui.hudPick.hidden = true;
    ui.selectionCard.hidden = true;
    state.selection = null;
    return;
  }

  // Tapping a lever flips it rather than merely selecting it.
  if (isLever(cell.name) && cell.structureIndex === state.active && state.redstone) {
    const now = state.redstone.toggle({ x: cell.lx, y: cell.ly, z: cell.lz });
    solvePower();
    toast(`Lever ${now ? "on" : "off"}`);
    return;
  }

  if (cell.structureIndex !== state.active) setActive(cell.structureIndex);

  const short = cell.name.replace(/^minecraft:/, "");
  ui.hudPick.hidden = false;
  ui.hudPick.innerHTML =
    `<b>${escapeHtml(short)}</b> <span>${cell.x}, ${cell.y}, ${cell.z}</span>` +
    (isModded(cell.name) ? ` <em>${escapeHtml(namespaceOf(cell.name))}</em>` : "");

  state.selection = { min: { x: cell.x, y: cell.y, z: cell.z }, max: { x: cell.x, y: cell.y, z: cell.z } };
  showSelection(1);
}

function onRegionEnd(selection) {
  if (!selection) return;
  state.selection = selection;
  const { min, max } = selection;
  const volume =
    (max.x - min.x + 1) * (max.y - min.y + 1) * (max.z - min.z + 1);
  showSelection(volume);
}

function showSelection(volume) {
  const { min, max } = state.selection;
  ui.selectionCard.hidden = false;
  ui.selectionInfo.textContent =
    `${max.x - min.x + 1}×${max.y - min.y + 1}×${max.z - min.z + 1}` +
    ` at ${min.x}, ${min.y}, ${min.z} · ${volume.toLocaleString()} cells`;
}

/** Applies the dragged region to the active build, cell by cell. */
function applySelection(mode) {
  const item = active();
  if (!item || !state.selection) return;

  const origin = item.structure.origin;
  const [sx, sy, sz] = item.structure.size;
  const { min, max } = state.selection;
  let touched = 0;

  for (let x = 0; x < sx; x++) {
    for (let y = 0; y < sy; y++) {
      for (let z = 0; z < sz; z++) {
        const wx = origin[0] + x;
        const wy = origin[1] + y;
        const wz = origin[2] + z;
        const inside =
          wx >= min.x && wx <= max.x &&
          wy >= min.y && wy <= max.y &&
          wz >= min.z && wz <= max.z;

        const shouldExclude = mode === "cut" ? inside : !inside;
        const index = item.structure.indexOf(x, y, z);
        if (shouldExclude) {
          if (!item.excluded.has(index)) touched++;
          item.excluded.add(index);
        }
      }
    }
  }

  toast(
    mode === "cut"
      ? `Cut ${touched.toLocaleString()} cells in the selection`
      : `Kept only the selection — ${touched.toLocaleString()} cells cut outside it`
  );
  rebuildScene();
  refreshHud();
  ui.exportResult.hidden = true;
}

/* ------------------------------------------------------------------ *
 * Assistant
 * ------------------------------------------------------------------ */

function renderAssistant() {
  const item = active();
  if (!item || !item.assist) {
    ui.assistantCard.hidden = true;
    return;
  }
  const a = item.assist;
  ui.assistantCard.hidden = false;
  ui.assistType.textContent = a.type;
  ui.assistAdvice.textContent = `${a.advice} ${PRESET_LABEL[a.preset]}.`;
  ui.assistConfidence.textContent = `${Math.round(a.confidence * 100)}% · "${a.matched}"`;
}

function applyAssistant() {
  const item = active();
  if (!item?.assist) return;
  item.removed = removalsFor(item.structure, item.assist.preset);
  renderBlockList();
  rebuildScene();
  refreshHud();
  toast(`Filter set for ${item.assist.type}`);
}

/* ------------------------------------------------------------------ *
 * Entities
 * ------------------------------------------------------------------ */

function renderEntities() {
  const item = active();
  if (!item) return;
  const { kept, skipped } = item.entities;

  if (!kept.length && !skipped) {
    ui.entityCard.hidden = true;
    return;
  }
  ui.entityCard.hidden = false;
  ui.entityTally.textContent = `${kept.length} kept`;
  ui.entityInfo.textContent = kept.length
    ? summarise(kept).map((e) => `${e.count}× ${e.name}`).join(", ")
    : "None of the entities here are keepable.";
  if (skipped) {
    ui.entityInfo.textContent += ` · ${skipped} mob${skipped === 1 ? "" : "s"} skipped`;
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
  const item = active();
  if (!item) return;

  ui.blockList.innerHTML = "";
  for (const block of item.analysis) {
    const row = document.createElement("div");
    row.className = "brow";
    row.dataset.index = String(block.index);
    row.setAttribute("role", "checkbox");
    row.tabIndex = 0;

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
    row.querySelector(".brow-name").textContent = block.name.replace(/^minecraft:/, "");

    const cat = row.querySelector(".brow-cat");
    if (isModded(block.name)) {
      cat.textContent = namespaceOf(block.name);
      cat.classList.add("is-modded");
    } else {
      cat.textContent = CATEGORY_LABEL[block.category];
    }
    row.querySelector(".brow-count").textContent = block.count.toLocaleString();

    const toggle = () => setRemoved(block.index, !item.removed.has(block.index));
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
  const cut = active().removed.has(index);
  row.classList.toggle("is-cut", cut);
  row.setAttribute("aria-checked", String(!cut));
  row.querySelector(".brow-state").textContent = cut ? "cut" : "keep";
}

function setRemoved(index, cut) {
  const item = active();
  if (cut) item.removed.add(index);
  else item.removed.delete(index);

  const row = ui.blockList.querySelector(`.brow[data-index="${index}"]`);
  if (row) paintRow(row, index);

  refreshBlockTally();
  rebuildScene();
  refreshHud();
  ui.exportResult.hidden = true;
}

function refreshBlockTally() {
  const item = active();
  const total = item.analysis.length;
  const cut = item.analysis.filter((b) => item.removed.has(b.index)).length;
  ui.blockTally.textContent = `${total - cut}/${total} kept`;
}

function onQuickAction(event) {
  const action = event.target.closest("[data-quick]")?.dataset.quick;
  const item = active();
  if (!action || !item) return;

  if (action === "clutter") item.removed = item.structure.defaultRemovals(false);
  else if (action === "rock") item.removed = item.structure.defaultRemovals(true);
  else if (action === "none") item.removed = new Set();
  else if (action === "invert") {
    const next = new Set();
    for (const block of item.analysis) {
      if (!item.removed.has(block.index)) next.add(block.index);
    }
    item.removed = next;
  }

  for (const row of ui.blockList.querySelectorAll(".brow")) {
    paintRow(row, Number(row.dataset.index));
  }
  refreshBlockTally();
  rebuildScene();
  refreshHud();
  ui.exportResult.hidden = true;
}

/* ------------------------------------------------------------------ *
 * Readout
 * ------------------------------------------------------------------ */

function refreshHud() {
  const item = active();
  if (!item) return;
  const s = item.structure;

  ui.hudName.textContent = item.entry.name;

  let kept = 0;
  let cut = 0;
  for (const block of item.analysis) {
    if (block.category === CATEGORY.AIR) continue;
    if (item.removed.has(block.index)) cut += block.count;
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
  const item = active();
  if (!item) return;

  let result;
  try {
    result = item.structure.export(item.removed, {
      crop: ui.optCrop.checked,
      keepEntities: ui.optEntities.checked,
      excludedCells: item.excluded.size ? item.excluded : null,
      entityTags: keepableTags(item.entities.kept)
    });
  } catch (err) {
    showResult(err.message ?? String(err), true);
    return;
  }

  const name = `${sanitize(item.entry.name)}.mcstructure`;
  download(new Blob([result.buffer], { type: "application/octet-stream" }), name);

  const [ox, oy, oz] = result.trimmed.from;
  const [nx, ny, nz] = result.size;
  showResult(
    [
      `Saved ${name}`,
      `${result.blockCount.toLocaleString()} blocks, ${result.paletteSize} block types`,
      ox !== nx || oy !== ny || oz !== nz
        ? `Trimmed ${ox}×${oy}×${oz} → ${nx}×${ny}×${nz}`
        : `Size ${nx}×${ny}×${nz}`
    ].join("\n"),
    false
  );
}

/**
 * In the Android build a WebView cannot follow a blob: download, so the app
 * exposes a bridge that writes the bytes into Downloads. Same call site either
 * way.
 */
function download(blob, filename) {
  const bridge = window.SchemBench;
  if (bridge && typeof bridge.saveFile === "function") {
    blob
      .arrayBuffer()
      .then((buf) => {
        if (!bridge.saveFile(filename, base64FromBuffer(buf))) {
          toast("Android could not write the file.", true);
        }
      })
      .catch((err) => toast(err.message ?? String(err), true));
    return;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Chunked so a large structure does not blow the argument limit on apply(). */
function base64FromBuffer(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
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

let lastPanel = "structures";

function showPanel(which) {
  if (which !== "support") lastPanel = which;
  for (const el of document.querySelectorAll("[data-panel]")) {
    el.classList.toggle("is-shown", el.dataset.panel === which);
  }
  for (const el of ui.tabs.querySelectorAll(".tab")) {
    el.classList.toggle("is-on", el.dataset.tab === which);
  }
  if (which === "view" && holo) requestAnimationFrame(() => holo.resize());
  // Loaded on demand so the donation page costs nothing until asked for.
  if (which === "support" && ui.supportFrame.src.endsWith("about:blank")) {
    ui.supportFrame.src = "donate.html";
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

let toastTimer = null;
function toast(message, bad = false) {
  ui.toast.textContent = message;
  ui.toast.classList.toggle("is-bad", bad);
  ui.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    ui.toast.hidden = true;
  }, bad ? 6000 : 3000);
}

boot();
