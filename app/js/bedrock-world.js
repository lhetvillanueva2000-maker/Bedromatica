/**
 * Bedrock terrain: chunk keys and subchunk block storage.
 *
 * Keys in the world database are packed binary, not strings:
 *
 *   <x int32 LE><z int32 LE>[<dimension int32 LE>]<tag u8>[<subY i8>]
 *
 * The dimension field is present only for the Nether and the End, so a key is
 * 9/10 bytes in the Overworld and 13/14 elsewhere. Tag 0x2f is SubChunkPrefix,
 * the one that carries blocks, and its trailing byte is the subchunk's Y index.
 *
 * A subchunk holds 16x16x16 cells as one or more "storages" - layer 0 is the
 * block, layer 1 is whatever is waterlogged into it. Each storage is a bit-
 * packed index array plus its own palette, with the index count per 32-bit word
 * chosen so indices never straddle a word boundary. That padding is the detail
 * most naive readers get wrong.
 */

import { parse as parseNbt, TAG } from "./nbt.js";

export const TAG_SUBCHUNK = 0x2f;
export const TAG_VERSION = 0x76;
export const TAG_VERSION_LEGACY = 0x2c;

export const DIMENSION = { OVERWORLD: 0, NETHER: 1, END: 2 };

/**
 * @returns {{x:number, z:number, dimension:number, tag:number, subY:number|null}|null}
 */
export function parseChunkKey(key) {
  const len = key.length;
  // Only these four shapes are chunk keys; everything else in the database is
  // player data, maps, village records and so on.
  if (len !== 9 && len !== 10 && len !== 13 && len !== 14) return null;

  const view = new DataView(key.buffer, key.byteOffset, key.byteLength);
  const hasDimension = len >= 13;

  const x = view.getInt32(0, true);
  const z = view.getInt32(4, true);
  const dimension = hasDimension ? view.getInt32(8, true) : DIMENSION.OVERWORLD;
  if (hasDimension && (dimension < 0 || dimension > 2)) return null;

  const tagAt = hasDimension ? 12 : 8;
  const tag = key[tagAt];
  const subY = len === tagAt + 2 ? (key[tagAt + 1] << 24) >> 24 : null; // signed

  return { x, z, dimension, tag, subY };
}

/**
 * Decodes one subchunk into a palette plus a 4096-entry index array.
 *
 * @param {Uint8Array} value the raw record
 * @returns {{subY:number|null, layers:Array<{palette:string[], indices:Uint16Array}>}|null}
 */
export function decodeSubChunk(value) {
  if (!value || value.length < 2) return null;

  let at = 0;
  const version = value[at++];
  let storageCount = 1;
  let subY = null;

  if (version === 1) {
    storageCount = 1;
  } else if (version === 8) {
    storageCount = value[at++];
  } else if (version === 9) {
    storageCount = value[at++];
    subY = (value[at++] << 24) >> 24; // signed: caves-and-cliffs worlds go below 0
  } else {
    return null; // an unknown layout is better skipped than guessed at
  }

  const layers = [];
  for (let s = 0; s < storageCount; s++) {
    const layer = decodeStorage(value, at);
    if (!layer) break;
    layers.push({ palette: layer.palette, indices: layer.indices });
    at = layer.next;
  }

  return layers.length ? { subY, layers } : null;
}

function decodeStorage(value, start) {
  let at = start;
  if (at >= value.length) return null;

  const header = value[at++];
  const bitsPerBlock = header >> 1;
  if (bitsPerBlock === 0 || bitsPerBlock > 16) return null;

  // Indices are packed so none straddles a word: a 32-bit word holds
  // floor(32 / bits) of them and any leftover bits are padding.
  const perWord = Math.floor(32 / bitsPerBlock);
  const wordCount = Math.ceil(4096 / perWord);
  const byteLength = wordCount * 4;
  if (at + byteLength > value.length) return null;

  const view = new DataView(value.buffer, value.byteOffset + at, byteLength);
  const indices = new Uint16Array(4096);
  const mask = (1 << bitsPerBlock) - 1;

  let written = 0;
  for (let w = 0; w < wordCount && written < 4096; w++) {
    const word = view.getUint32(w * 4, true);
    for (let s = 0; s < perWord && written < 4096; s++) {
      indices[written++] = (word >>> (s * bitsPerBlock)) & mask;
    }
  }
  at += byteLength;

  if (at + 4 > value.length) return null;
  const sizeView = new DataView(value.buffer, value.byteOffset + at, 4);
  const paletteSize = sizeView.getInt32(0, true);
  at += 4;
  if (paletteSize <= 0 || paletteSize > 65536) return null;

  // The palette is a run of little-endian NBT compounds, back to back. Each is
  // parsed in turn and the cursor advanced by however much it consumed.
  const palette = [];
  for (let i = 0; i < paletteSize; i++) {
    const slice = value.buffer.slice(value.byteOffset + at, value.byteOffset + value.length);
    let root;
    try {
      root = parseNbt(slice);
    } catch {
      return null;
    }
    const name = root.tag?.v?.get?.("name")?.v;
    palette.push(typeof name === "string" ? name : "minecraft:unknown");
    at += root.consumed ?? 0;
    if (!root.consumed) return null;
  }

  return { palette, indices, next: at };
}

/** Cell order inside a subchunk is x, then z, then y. */
export function cellIndex(x, y, z) {
  return (x << 8) | (z << 4) | y;
}

/**
 * Collects every subchunk in a database into something the renderer can walk.
 *
 * Terrain is kept per chunk column rather than flattened, so a bounded region
 * can be pulled out later without holding the whole world as objects.
 */
export class TerrainIndex {
  constructor() {
    /** @type {Map<string, Map<number, object>>} "x,z" -> subY -> decoded */
    this.columns = new Map();
    this.dimension = DIMENSION.OVERWORLD;
    this.stats = { subchunks: 0, skipped: 0, columns: 0 };
    this.bounds = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
  }

  /** @param {Uint8Array} key @param {Uint8Array} value */
  offer(key, value) {
    const parsed = parseChunkKey(key);
    if (!parsed || parsed.tag !== TAG_SUBCHUNK) return;
    if (parsed.dimension !== this.dimension) return;

    const decoded = decodeSubChunk(value);
    if (!decoded) {
      this.stats.skipped++;
      return;
    }

    const id = `${parsed.x},${parsed.z}`;
    let column = this.columns.get(id);
    if (!column) {
      column = new Map();
      this.columns.set(id, column);
      this.stats.columns++;
      if (parsed.x < this.bounds.minX) this.bounds.minX = parsed.x;
      if (parsed.z < this.bounds.minZ) this.bounds.minZ = parsed.z;
      if (parsed.x > this.bounds.maxX) this.bounds.maxX = parsed.x;
      if (parsed.z > this.bounds.maxZ) this.bounds.maxZ = parsed.z;
    }

    // v9 carries its own Y; older layouts take it from the key.
    const y = decoded.subY ?? parsed.subY ?? 0;
    column.set(y, decoded);
    this.stats.subchunks++;
  }

  get chunkCount() {
    return this.columns.size;
  }

  /** Block name at a world position, or null where nothing is stored. */
  blockAt(wx, wy, wz) {
    const cx = wx >> 4;
    const cz = wz >> 4;
    const column = this.columns.get(`${cx},${cz}`);
    if (!column) return null;

    const sy = Math.floor(wy / 16);
    const sub = column.get(sy);
    if (!sub) return null;

    const layer = sub.layers[0];
    if (!layer) return null;

    const i = cellIndex(wx & 15, ((wy % 16) + 16) % 16, wz & 15);
    return layer.palette[layer.indices[i]] ?? null;
  }

  /** Every stored column key, as {x, z} chunk coordinates. */
  columnList() {
    return [...this.columns.keys()].map((k) => {
      const [x, z] = k.split(",").map(Number);
      return { x, z };
    });
  }

  /**
   * Extracts only the blocks that could actually be seen, as typed arrays.
   *
   * Two things keep this cheap enough for a real world. First, a block with
   * solid neighbours on all six sides is dropped - in ordinary terrain that is
   * the overwhelming majority, so a full chunk column collapses from 100k+
   * cells to a few thousand surface ones. Second, the result is typed arrays
   * rather than objects: a million cells as {x,y,z,name} objects is hundreds of
   * megabytes and a garbage-collection stall, while the same data as Int16Array
   * plus a shared palette is a few megabytes and transfers to the renderer with
   * no copy at all.
   *
   * @param {{centre:{x:number,z:number}, radius:number, yMin:number, yMax:number, limit:number}} opts
   */
  surfaceCells(opts) {
    const { centre = { x: 0, z: 0 }, radius = 4, yMin = -64, yMax = 320, limit = 400000 } = opts;

    const names = [];
    const nameIds = new Map();
    const idFor = (name) => {
      let id = nameIds.get(name);
      if (id === undefined) {
        id = names.length;
        names.push(name);
        nameIds.set(name, id);
      }
      return id;
    };

    // Grown rather than preallocated: the true count is unknown until the scan
    // finishes, and over-allocating for the limit would waste tens of MB.
    let capacity = 1 << 16;
    let xs = new Int32Array(capacity);
    let ys = new Int32Array(capacity);
    let zs = new Int32Array(capacity);
    let ids = new Uint16Array(capacity);
    let count = 0;

    const push = (x, y, z, id) => {
      if (count === capacity) {
        capacity *= 2;
        const nx = new Int32Array(capacity); nx.set(xs); xs = nx;
        const ny = new Int32Array(capacity); ny.set(ys); ys = ny;
        const nz = new Int32Array(capacity); nz.set(zs); zs = nz;
        const ni = new Uint16Array(capacity); ni.set(ids); ids = ni;
      }
      xs[count] = x; ys[count] = y; zs[count] = z; ids[count] = id;
      count++;
    };

    const isAir = (name) =>
      name === null || name === "minecraft:air" || name === "minecraft:structure_void";

    let truncated = false;

    outer:
    for (let cx = centre.x - radius; cx <= centre.x + radius; cx++) {
      for (let cz = centre.z - radius; cz <= centre.z + radius; cz++) {
        const column = this.columns.get(`${cx},${cz}`);
        if (!column) continue;

        for (const [sy, sub] of column) {
          const baseY = sy * 16;
          if (baseY + 15 < yMin || baseY > yMax) continue;
          const layer = sub.layers[0];
          if (!layer) continue;

          for (let lx = 0; lx < 16; lx++) {
            for (let lz = 0; lz < 16; lz++) {
              for (let ly = 0; ly < 16; ly++) {
                const wy = baseY + ly;
                if (wy < yMin || wy > yMax) continue;

                const name = layer.palette[layer.indices[cellIndex(lx, ly, lz)]];
                if (isAir(name)) continue;

                const wx = cx * 16 + lx;
                const wz = cz * 16 + lz;

                // A cell hidden on all six sides can never be seen, so it is
                // not worth an instance. The top of the slice always counts as
                // exposed, otherwise a Y cut would show a sealed surface.
                const exposed =
                  wy === yMax ||
                  isAir(this.blockAt(wx - 1, wy, wz)) ||
                  isAir(this.blockAt(wx + 1, wy, wz)) ||
                  isAir(this.blockAt(wx, wy - 1, wz)) ||
                  isAir(this.blockAt(wx, wy + 1, wz)) ||
                  isAir(this.blockAt(wx, wy, wz - 1)) ||
                  isAir(this.blockAt(wx, wy, wz + 1));
                if (!exposed) continue;

                push(wx, wy, wz, idFor(name));
                if (count >= limit) {
                  truncated = true;
                  break outer;
                }
              }
            }
          }
        }
      }
    }

    return {
      count,
      truncated,
      names,
      x: xs.subarray(0, count),
      y: ys.subarray(0, count),
      z: zs.subarray(0, count),
      id: ids.subarray(0, count)
    };
  }
}
