/**
 * .mcstructure model: read, filter, crop, write back.
 *
 * Layout of the format, since it is barely documented anywhere:
 *
 *   size                     List<Int> [x, y, z]
 *   structure_world_origin   List<Int> [x, y, z]
 *   structure
 *     block_indices          List<List<Int>>   two layers; [0] blocks, [1] waterlogging
 *     entities               List<Compound>
 *     palette.default
 *       block_palette        List<Compound>    { name, states, version }
 *       block_position_data  Compound          keyed by stringified block index
 *
 * A cell's index is (x * sizeY + y) * sizeZ + z - X outermost, Z innermost.
 * An index of -1 means "structure void": the game skips that cell entirely on
 * paste, leaving whatever was already there. That is the mechanism the whole
 * clutter-removal feature rests on - stripped terrain becomes void, not air,
 * so pasting a build into a hillside does not carve a box out of the hill.
 */

import { parse, write, get, TAG } from "./nbt.js";
import { classify, isDefaultCut, isTerrainOfAnyKind, CATEGORY } from "./blocks.js";

export class McStructure {
  /** @param {ArrayBuffer} buffer */
  constructor(buffer) {
    this.root = parse(buffer);
    const tag = this.root.tag;

    const sizeTag = get(tag, "size");
    if (!sizeTag || sizeTag.t !== TAG.List) {
      throw new Error("Missing size - this does not look like a .mcstructure.");
    }
    this.size = sizeTag.v.items.map((i) => i.v);

    const indicesTag = get(tag, "structure/block_indices");
    if (!indicesTag) throw new Error("Missing block_indices.");
    this.layers = indicesTag.v.items.map((layer) => layer.v.items.map((i) => i.v));

    const paletteTag = get(tag, "structure/palette/default/block_palette");
    if (!paletteTag) throw new Error("Missing block_palette.");
    this.palette = paletteTag.v.items.map((entry) => ({
      name: entry.v.get("name")?.v ?? "minecraft:unknown",
      tag: entry
    }));

    this.positionData = get(tag, "structure/palette/default/block_position_data");
    this.entities = get(tag, "structure/entities");
    this.origin = get(tag, "structure_world_origin")?.v.items.map((i) => i.v) ?? [0, 0, 0];
  }

  get volume() {
    return this.size[0] * this.size[1] * this.size[2];
  }

  indexOf(x, y, z) {
    return (x * this.size[1] + y) * this.size[2] + z;
  }

  /**
   * Per-palette-entry counts plus a suggested category, which is what the
   * app's block list is built from.
   */
  analyze() {
    const counts = new Array(this.palette.length).fill(0);
    const blocks = this.layers[0] ?? [];
    for (let i = 0; i < blocks.length; i++) {
      const p = blocks[i];
      if (p >= 0 && p < counts.length) counts[p]++;
    }

    return this.palette
      .map((entry, index) => ({
        index,
        name: entry.name,
        count: counts[index],
        category: classify(entry.name)
      }))
      .filter((e) => e.count > 0)
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Palette indices ticked for removal on load: loose ground, plants, fluids.
   * @param {boolean} includeRock also sweep stone, deepslate and friends
   */
  defaultRemovals(includeRock = false) {
    const test = includeRock ? isTerrainOfAnyKind : isDefaultCut;
    const out = new Set();
    this.palette.forEach((entry, index) => {
      if (test(entry.name)) out.add(index);
    });
    return out;
  }

  /**
   * Builds a new structure with `removed` palette indices turned into
   * structure void, optionally cropped to what is left.
   *
   * Cropping measures the bounds of surviving *solid* blocks only - air that
   * happens to sit inside the build is kept (a room stays hollow, a redstone
   * gap stays a gap) but air trailing off the edges does not inflate the box.
   *
   * @param {Set<number>} removed palette indices to strip
   * @param {{crop?: boolean, keepEntities?: boolean}} options
   */
  export(removed, options = {}) {
    const { crop = true, keepEntities = false } = options;
    const [sx, sy, sz] = this.size;
    const blocks = this.layers[0] ?? [];
    const water = this.layers[1] ?? [];

    const survives = (p) => p >= 0 && p < this.palette.length && !removed.has(p);

    // 1. Work out the crop window from solid survivors.
    let minX = sx, minY = sy, minZ = sz;
    let maxX = -1, maxY = -1, maxZ = -1;
    let solidCount = 0;

    for (let x = 0; x < sx; x++) {
      for (let y = 0; y < sy; y++) {
        for (let z = 0; z < sz; z++) {
          const p = blocks[this.indexOf(x, y, z)];
          if (!survives(p)) continue;
          if (classify(this.palette[p].name) === CATEGORY.AIR) continue;
          solidCount++;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (z < minZ) minZ = z;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
          if (z > maxZ) maxZ = z;
        }
      }
    }

    if (solidCount === 0) {
      throw new Error("Nothing left to export - every block is marked for removal.");
    }

    if (!crop) {
      minX = 0; minY = 0; minZ = 0;
      maxX = sx - 1; maxY = sy - 1; maxZ = sz - 1;
    }

    const nx = maxX - minX + 1;
    const ny = maxY - minY + 1;
    const nz = maxZ - minZ + 1;

    // 2. Rebuild the palette from only the entries that survive and are used.
    const remap = new Map();
    const newPaletteTags = [];
    const newBlocks = new Array(nx * ny * nz);
    const newWater = new Array(nx * ny * nz);
    const newPositionData = new Map();

    const oldPositionData = this.positionData?.t === TAG.Compound ? this.positionData.v : null;

    for (let x = 0; x < nx; x++) {
      for (let y = 0; y < ny; y++) {
        for (let z = 0; z < nz; z++) {
          const oldIndex = this.indexOf(x + minX, y + minY, z + minZ);
          const newIndex = (x * ny + y) * nz + z;
          const p = blocks[oldIndex];

          if (!survives(p)) {
            newBlocks[newIndex] = -1;
            newWater[newIndex] = -1;
            continue;
          }

          let mapped = remap.get(p);
          if (mapped === undefined) {
            mapped = newPaletteTags.length;
            remap.set(p, mapped);
            newPaletteTags.push(this.palette[p].tag);
          }
          newBlocks[newIndex] = mapped;

          // Waterlogging layer only survives if its own palette entry does.
          const w = water[oldIndex];
          if (survives(w)) {
            let mappedW = remap.get(w);
            if (mappedW === undefined) {
              mappedW = newPaletteTags.length;
              remap.set(w, mappedW);
              newPaletteTags.push(this.palette[w].tag);
            }
            newWater[newIndex] = mappedW;
          } else {
            newWater[newIndex] = -1;
          }

          // Chest contents, sign text, command blocks: keyed by cell index.
          if (oldPositionData) {
            const carried = oldPositionData.get(String(oldIndex));
            if (carried) newPositionData.set(String(newIndex), carried);
          }
        }
      }
    }

    // 3. Reassemble the NBT tree around the new arrays.
    const out = structuredCloneTag(this.root);
    const tag = out.tag;

    setList(tag, "size", TAG.Int, [nx, ny, nz]);
    setList(tag, "structure_world_origin", TAG.Int, [
      this.origin[0] + minX,
      this.origin[1] + minY,
      this.origin[2] + minZ
    ]);

    const structure = tag.v.get("structure");
    structure.v.set("block_indices", {
      t: TAG.List,
      v: {
        et: TAG.List,
        items: [intList(newBlocks), intList(newWater)]
      }
    });

    const paletteDefault = get(tag, "structure/palette/default");
    paletteDefault.v.set("block_palette", {
      t: TAG.List,
      v: { et: TAG.Compound, items: newPaletteTags }
    });
    paletteDefault.v.set("block_position_data", { t: TAG.Compound, v: newPositionData });

    structure.v.set("entities", {
      t: TAG.List,
      v: { et: TAG.Compound, items: keepEntities ? (this.entities?.v.items ?? []) : [] }
    });

    return {
      buffer: write(out),
      size: [nx, ny, nz],
      blockCount: solidCount,
      paletteSize: newPaletteTags.length,
      trimmed: {
        from: [sx, sy, sz],
        to: [nx, ny, nz]
      }
    };
  }

  /**
   * Flat list of visible cells for the 3D view. Blocks fully enclosed by
   * opaque neighbours are dropped, which is what makes a solid build render at
   * a few thousand instances instead of a few hundred thousand.
   */
  visibleCells(removed) {
    const [sx, sy, sz] = this.size;
    const blocks = this.layers[0] ?? [];
    const cells = [];

    const solidAt = (x, y, z) => {
      if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) return false;
      const p = blocks[this.indexOf(x, y, z)];
      if (p < 0 || p >= this.palette.length) return false;
      return classify(this.palette[p].name) !== CATEGORY.AIR;
    };

    for (let x = 0; x < sx; x++) {
      for (let y = 0; y < sy; y++) {
        for (let z = 0; z < sz; z++) {
          const p = blocks[this.indexOf(x, y, z)];
          if (p < 0 || p >= this.palette.length) continue;
          const name = this.palette[p].name;
          if (classify(name) === CATEGORY.AIR) continue;

          const enclosed =
            solidAt(x - 1, y, z) && solidAt(x + 1, y, z) &&
            solidAt(x, y - 1, z) && solidAt(x, y + 1, z) &&
            solidAt(x, y, z - 1) && solidAt(x, y, z + 1);
          if (enclosed) continue;

          cells.push({ x, y, z, palette: p, name, kept: !removed.has(p) });
        }
      }
    }
    return cells;
  }
}

/* ------------------------------------------------------------------ *
 * Tag helpers
 * ------------------------------------------------------------------ */

function intList(values) {
  return {
    t: TAG.List,
    v: { et: TAG.Int, items: values.map((v) => ({ t: TAG.Int, v })) }
  };
}

function setList(tag, key, elementType, values) {
  tag.v.set(key, {
    t: TAG.List,
    v: { et: elementType, items: values.map((v) => ({ t: elementType, v })) }
  });
}

/** Deep copy that understands Maps, so the source structure is never mutated. */
function structuredCloneTag(node) {
  if (node === null || typeof node !== "object") return node;
  if (node instanceof Map) {
    const m = new Map();
    for (const [k, v] of node) m.set(k, structuredCloneTag(v));
    return m;
  }
  if (ArrayBuffer.isView(node)) return node.slice();
  if (Array.isArray(node)) return node.map(structuredCloneTag);
  const out = {};
  for (const k of Object.keys(node)) out[k] = structuredCloneTag(node[k]);
  return out;
}

/* ------------------------------------------------------------------ *
 * .mcworld reading
 * ------------------------------------------------------------------ */

/**
 * Pulls every structure out of an exported world.
 * @param {JSZip} zip an opened .mcworld
 */
export async function listStructures(zip) {
  const found = [];
  zip.forEach((path, entry) => {
    if (entry.dir) return;
    if (!path.toLowerCase().endsWith(".mcstructure")) return;
    const parts = path.split("/");
    const file = parts[parts.length - 1];
    const namespace = parts.length >= 2 ? parts[parts.length - 2] : "mystructure";
    found.push({
      path,
      namespace,
      name: file.replace(/\.mcstructure$/i, ""),
      entry
    });
  });
  found.sort((a, b) => a.name.localeCompare(b.name));
  return found;
}
