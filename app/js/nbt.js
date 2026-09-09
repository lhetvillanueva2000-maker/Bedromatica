/**
 * Bedrock NBT - little-endian, uncompressed.
 *
 * .mcstructure files are raw little-endian NBT with no gzip wrapper, which is
 * what separates them from Java's .nbt. Tags round-trip through a tagged
 * representation ({t, v}) rather than plain JS values, because writing a file
 * back byte-for-byte means keeping every type and every key's order exactly as
 * it came in. A structure that loses its block-entity types loses chest
 * contents and command blocks, so nothing here is allowed to guess.
 */

export const TAG = {
  End: 0,
  Byte: 1,
  Short: 2,
  Int: 3,
  Long: 4,
  Float: 5,
  Double: 6,
  ByteArray: 7,
  String: 8,
  List: 9,
  Compound: 10,
  IntArray: 11,
  LongArray: 12
};

const utf8Decode = new TextDecoder();
const utf8Encode = new TextEncoder();

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

class Reader {
  constructor(buffer) {
    this.view = new DataView(buffer);
    this.bytes = new Uint8Array(buffer);
    this.off = 0;
  }

  /**
   * Running off the end means the file is truncated or is not NBT at all.
   * Raised here so the app can say that, rather than surfacing a DataView
   * RangeError from somewhere deep in the tree.
   */
  need(n) {
    if (this.off + n > this.view.byteLength) {
      throw new Error(
        "File ended unexpectedly - it is truncated, or not a Bedrock .mcstructure."
      );
    }
  }

  u8() {
    this.need(1);
    return this.view.getUint8(this.off++);
  }
  i8() {
    this.need(1);
    return this.view.getInt8(this.off++);
  }
  i16() {
    this.need(2);
    const v = this.view.getInt16(this.off, true);
    this.off += 2;
    return v;
  }
  u16() {
    this.need(2);
    const v = this.view.getUint16(this.off, true);
    this.off += 2;
    return v;
  }
  i32() {
    this.need(4);
    const v = this.view.getInt32(this.off, true);
    this.off += 4;
    return v;
  }
  i64() {
    this.need(8);
    const v = this.view.getBigInt64(this.off, true);
    this.off += 8;
    return v;
  }
  f32() {
    this.need(4);
    const v = this.view.getFloat32(this.off, true);
    this.off += 4;
    return v;
  }
  f64() {
    this.need(8);
    const v = this.view.getFloat64(this.off, true);
    this.off += 8;
    return v;
  }
  str() {
    const len = this.u16();
    this.need(len);
    const s = utf8Decode.decode(this.bytes.subarray(this.off, this.off + len));
    this.off += len;
    return s;
  }

  payload(type) {
    switch (type) {
      case TAG.Byte:
        return this.i8();
      case TAG.Short:
        return this.i16();
      case TAG.Int:
        return this.i32();
      case TAG.Long:
        return this.i64();
      case TAG.Float:
        return this.f32();
      case TAG.Double:
        return this.f64();
      case TAG.ByteArray: {
        const n = this.i32();
        const a = new Int8Array(n);
        for (let i = 0; i < n; i++) a[i] = this.i8();
        return a;
      }
      case TAG.String:
        return this.str();
      case TAG.List: {
        const et = this.u8();
        const n = this.i32();
        const items = new Array(n);
        for (let i = 0; i < n; i++) items[i] = { t: et, v: this.payload(et) };
        return { et, items };
      }
      case TAG.Compound: {
        const map = new Map();
        for (;;) {
          const t = this.u8();
          if (t === TAG.End) break;
          const name = this.str();
          map.set(name, { t, v: this.payload(t) });
        }
        return map;
      }
      case TAG.IntArray: {
        const n = this.i32();
        const a = new Int32Array(n);
        for (let i = 0; i < n; i++) a[i] = this.i32();
        return a;
      }
      case TAG.LongArray: {
        const n = this.i32();
        const a = new BigInt64Array(n);
        for (let i = 0; i < n; i++) a[i] = this.i64();
        return a;
      }
      default:
        throw new Error(`Unknown NBT tag type ${type} at byte ${this.off - 1}`);
    }
  }
}

/**
 * @param {ArrayBuffer} buffer
 * @returns {{name: string, tag: {t: number, v: any}, consumed: number}}
 *   `consumed` is how many bytes the root tag occupied. A block palette in a
 *   Bedrock subchunk is a run of compounds packed back to back with no length
 *   prefix, so the only way to reach the next one is to know where this one
 *   ended.
 */
export function parse(buffer) {
  const r = new Reader(buffer);
  const t = r.u8();
  if (t !== TAG.Compound) {
    throw new Error("Not a .mcstructure: the file does not start with an NBT compound.");
  }
  const name = r.str();
  const value = r.payload(t);
  return { name, tag: { t, v: value }, consumed: r.off };
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

class Writer {
  constructor() {
    this.buf = new Uint8Array(1 << 16);
    this.view = new DataView(this.buf.buffer);
    this.off = 0;
  }

  need(n) {
    if (this.off + n <= this.buf.length) return;
    let size = this.buf.length;
    while (size < this.off + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf);
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  u8(v) {
    this.need(1);
    this.view.setUint8(this.off++, v);
  }
  i8(v) {
    this.need(1);
    this.view.setInt8(this.off++, v);
  }
  i16(v) {
    this.need(2);
    this.view.setInt16(this.off, v, true);
    this.off += 2;
  }
  u16(v) {
    this.need(2);
    this.view.setUint16(this.off, v, true);
    this.off += 2;
  }
  i32(v) {
    this.need(4);
    this.view.setInt32(this.off, v, true);
    this.off += 4;
  }
  i64(v) {
    this.need(8);
    this.view.setBigInt64(this.off, BigInt(v), true);
    this.off += 8;
  }
  f32(v) {
    this.need(4);
    this.view.setFloat32(this.off, v, true);
    this.off += 4;
  }
  f64(v) {
    this.need(8);
    this.view.setFloat64(this.off, v, true);
    this.off += 8;
  }
  str(s) {
    const enc = utf8Encode.encode(s);
    this.u16(enc.length);
    this.need(enc.length);
    this.buf.set(enc, this.off);
    this.off += enc.length;
  }

  payload(type, v) {
    switch (type) {
      case TAG.Byte:
        return this.i8(v);
      case TAG.Short:
        return this.i16(v);
      case TAG.Int:
        return this.i32(v);
      case TAG.Long:
        return this.i64(v);
      case TAG.Float:
        return this.f32(v);
      case TAG.Double:
        return this.f64(v);
      case TAG.ByteArray: {
        this.i32(v.length);
        for (let i = 0; i < v.length; i++) this.i8(v[i]);
        return;
      }
      case TAG.String:
        return this.str(v);
      case TAG.List: {
        this.u8(v.et);
        this.i32(v.items.length);
        for (const item of v.items) this.payload(v.et, item.v);
        return;
      }
      case TAG.Compound: {
        for (const [name, tag] of v) {
          this.u8(tag.t);
          this.str(name);
          this.payload(tag.t, tag.v);
        }
        this.u8(TAG.End);
        return;
      }
      case TAG.IntArray: {
        this.i32(v.length);
        for (let i = 0; i < v.length; i++) this.i32(v[i]);
        return;
      }
      case TAG.LongArray: {
        this.i32(v.length);
        for (let i = 0; i < v.length; i++) this.i64(v[i]);
        return;
      }
      default:
        throw new Error(`Cannot write NBT tag type ${type}`);
    }
  }

  finish() {
    return this.buf.buffer.slice(0, this.off);
  }
}

/**
 * @param {{name: string, tag: {t: number, v: any}}} root
 * @returns {ArrayBuffer}
 */
export function write(root) {
  const w = new Writer();
  w.u8(root.tag.t);
  w.str(root.name);
  w.payload(root.tag.t, root.tag.v);
  return w.finish();
}

/* ------------------------------------------------------------------ *
 * Small helpers for walking a parsed tree
 * ------------------------------------------------------------------ */

/** Reads a path like "structure/palette/default" out of a compound. */
export function get(tag, path) {
  let cur = tag;
  for (const key of path.split("/")) {
    if (!cur || cur.t !== TAG.Compound) return undefined;
    cur = cur.v.get(key);
  }
  return cur;
}

export const compound = (entries = []) => ({ t: TAG.Compound, v: new Map(entries) });
export const list = (et, items) => ({ t: TAG.List, v: { et, items } });
export const int = (v) => ({ t: TAG.Int, v });
export const str = (v) => ({ t: TAG.String, v });
