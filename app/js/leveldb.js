/**
 * LevelDB SST reader - enough of it to read a Bedrock world's `db/` folder.
 *
 * Bedrock stores terrain in a fork of LevelDB. The table format itself is
 * stock, so this reads it straight:
 *
 *   footer (last 48 bytes)  metaindex handle, index handle, magic
 *   index block             one entry per data block, value = its handle
 *   data block              prefix-compressed key/value entries + restart array
 *   block trailer           1 compression byte + 4 crc bytes after every block
 *
 * The fork's only real difference is compression: Mojang writes raw zlib
 * rather than snappy. Both `deflate` and `deflate-raw` are handled through the
 * platform's own DecompressionStream, so there is no compression library here
 * and nothing to keep up to date.
 *
 * Snappy (type 1) is the one case this cannot read. Bedrock does not write it,
 * so rather than ship a snappy decoder that would never run, such a block is
 * skipped and reported - a partial world with an honest count beats a silent
 * hole.
 */

const MAGIC_LO = 0x8b80fb57;
const MAGIC_HI = 0xdb477524;

export const COMPRESSION = { NONE: 0, SNAPPY: 1, ZLIB: 2, ZLIB_RAW: 4 };

/** Trailer LevelDB appends to every stored key: (sequence << 8) | valueType. */
const INTERNAL_KEY_SUFFIX = 8;

/* ------------------------------------------------------------------ *
 * Primitives
 * ------------------------------------------------------------------ */

class Cursor {
  constructor(bytes, offset = 0) {
    this.b = bytes;
    this.i = offset;
  }

  /** LevelDB varints are little-endian base-128, up to 64 bits. */
  varint() {
    let result = 0;
    let shift = 0;
    for (;;) {
      if (this.i >= this.b.length) throw new Error("varint ran past the end of the block");
      const byte = this.b[this.i++];
      // Numbers stay exact below 2^53, which every offset in a world file is.
      result += (byte & 0x7f) * Math.pow(2, shift);
      if ((byte & 0x80) === 0) break;
      shift += 7;
      if (shift > 63) throw new Error("varint too long");
    }
    return result;
  }

  bytes(n) {
    const out = this.b.subarray(this.i, this.i + n);
    this.i += n;
    return out;
  }
}

async function inflate(bytes, type) {
  if (type === COMPRESSION.NONE) return bytes;
  if (type === COMPRESSION.SNAPPY) return null;

  const format = type === COMPRESSION.ZLIB_RAW ? "deflate-raw" : "deflate";
  const attempts = [format, format === "deflate" ? "deflate-raw" : "deflate"];

  for (const f of attempts) {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(f));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      // Mojang's compression byte is not always the one the data actually
      // uses; trying the other framing is cheaper than guessing wrong.
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Blocks
 * ------------------------------------------------------------------ */

/**
 * Decodes one block's entries. Keys are prefix-compressed against the
 * previous key, which is why they have to be walked in order.
 */
function readBlockEntries(data, onEntry) {
  if (data.length < 4) return;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const numRestarts = view.getUint32(data.length - 4, true);
  const restartsStart = data.length - 4 - numRestarts * 4;
  if (restartsStart < 0) throw new Error("block restart array is out of range");

  const cursor = new Cursor(data, 0);
  let previousKey = new Uint8Array(0);

  while (cursor.i < restartsStart) {
    const shared = cursor.varint();
    const unshared = cursor.varint();
    const valueLength = cursor.varint();
    if (shared > previousKey.length) throw new Error("shared key prefix is longer than the previous key");

    const key = new Uint8Array(shared + unshared);
    key.set(previousKey.subarray(0, shared), 0);
    key.set(cursor.bytes(unshared), shared);
    const value = cursor.bytes(valueLength);

    onEntry(key, value);
    previousKey = key;
  }
}

async function readBlockAt(bytes, offset, size) {
  const raw = bytes.subarray(offset, offset + size);
  const type = bytes[offset + size]; // trailer: 1 compression byte, then crc32c
  return { data: await inflate(raw, type), type };
}

/* ------------------------------------------------------------------ *
 * Table
 * ------------------------------------------------------------------ */

/**
 * Walks every key/value pair in one .ldb table.
 *
 * @param {Uint8Array} bytes the whole table file
 * @param {(key: Uint8Array, value: Uint8Array) => void} onEntry
 * @returns {Promise<{entries: number, skippedBlocks: number}>}
 */
export async function readTable(bytes, onEntry) {
  if (bytes.length < 48) throw new Error("file is too short to be an .ldb table");

  const footer = bytes.subarray(bytes.length - 48);
  const view = new DataView(footer.buffer, footer.byteOffset, footer.byteLength);
  if (view.getUint32(40, true) !== MAGIC_LO || view.getUint32(44, true) !== MAGIC_HI) {
    throw new Error("not a LevelDB table (bad footer magic)");
  }

  const cursor = new Cursor(footer, 0);
  cursor.varint();               // metaindex offset - filters, not needed here
  cursor.varint();               // metaindex size
  const indexOffset = cursor.varint();
  const indexSize = cursor.varint();

  const index = await readBlockAt(bytes, indexOffset, indexSize);
  if (!index.data) throw new Error("index block uses snappy, which is not supported");

  const handles = [];
  readBlockEntries(index.data, (_key, value) => {
    const c = new Cursor(value, 0);
    handles.push({ offset: c.varint(), size: c.varint() });
  });

  let entries = 0;
  let skippedBlocks = 0;

  for (const handle of handles) {
    let block;
    try {
      block = await readBlockAt(bytes, handle.offset, handle.size);
    } catch {
      skippedBlocks++;
      continue;
    }
    if (!block.data) {
      skippedBlocks++;
      continue;
    }
    try {
      readBlockEntries(block.data, (key, value) => {
        // Keys inside a data block are *internal* keys: the user key with an
        // 8-byte (sequence << 8 | valueType) trailer appended. Callers want the
        // user key, and a chunk key is identified by its exact length, so the
        // trailer has to come off or nothing matches.
        if (key.length < INTERNAL_KEY_SUFFIX) return;
        const type = key[key.length - INTERNAL_KEY_SUFFIX];
        if (type === 0) return; // a deletion tombstone: the key is gone

        entries++;
        onEntry(key.subarray(0, key.length - INTERNAL_KEY_SUFFIX), value);
      });
    } catch {
      skippedBlocks++;
    }
  }

  return { entries, skippedBlocks };
}

/* ------------------------------------------------------------------ *
 * Write-ahead log
 * ------------------------------------------------------------------ */

/**
 * Reads a `.log` file - the writes LevelDB has not compacted into a table yet.
 *
 * A world exported straight after playing usually has live chunks sitting only
 * here, so skipping the log means silently missing the most recent terrain.
 *
 * Layout: 32KB blocks, each a run of records with a 7-byte header
 * (crc32, uint16 length, type), where types 1..4 are FULL/FIRST/MIDDLE/LAST.
 * A reassembled record is a write batch: 8-byte sequence, 4-byte count, then
 * that many (type, key, [value]) triples.
 */
export function readLog(bytes, onEntry) {
  const BLOCK = 32768;
  let entries = 0;
  let pending = [];

  for (let base = 0; base < bytes.length; base += BLOCK) {
    let offset = base;
    const end = Math.min(base + BLOCK, bytes.length);

    while (offset + 7 <= end) {
      const view = new DataView(bytes.buffer, bytes.byteOffset + offset, Math.min(7, end - offset));
      const length = view.getUint16(4, true);
      const type = bytes[offset + 6];
      const dataStart = offset + 7;
      if (type === 0 || dataStart + length > end) break; // zero padding to the block edge

      const chunk = bytes.subarray(dataStart, dataStart + length);
      if (type === 1) {
        entries += applyBatch(chunk, onEntry);
      } else if (type === 2) {
        pending = [chunk];
      } else if (type === 3) {
        pending.push(chunk);
      } else if (type === 4) {
        pending.push(chunk);
        entries += applyBatch(concat(pending), onEntry);
        pending = [];
      }
      offset = dataStart + length;
    }
  }
  return { entries };
}

function applyBatch(record, onEntry) {
  if (record.length < 12) return 0;
  const view = new DataView(record.buffer, record.byteOffset, record.byteLength);
  const count = view.getUint32(8, true);

  const cursor = new Cursor(record, 12);
  let applied = 0;

  for (let i = 0; i < count; i++) {
    if (cursor.i >= record.length) break;
    const kind = record[cursor.i++];
    let key;
    try {
      key = cursor.bytes(cursor.varint());
      if (kind === 1) {
        onEntry(key, cursor.bytes(cursor.varint()));
        applied++;
      } else {
        // kind 0 is a deletion; the key is gone, so nothing to hand on.
      }
    } catch {
      break;
    }
  }
  return applied;
}

function concat(parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
