/**
 * Terrain loading, off the main thread.
 *
 * Reading a world's database means inflating tens of megabytes and walking
 * millions of cells. On the UI thread that is a multi-second freeze with no
 * frames drawn - on a phone it looks like the app has crashed. Here it is just
 * a progress number, and the result comes back as transferable typed arrays so
 * handing several million coordinates to the renderer costs no copy at all.
 */

import { readTable, readLog } from "./leveldb.js";
import { TerrainIndex } from "./bedrock-world.js";

let terrain = null;

// Announced as soon as the module and its imports have actually loaded. The
// page waits for this before handing over any world data: a worker that was
// constructed but cannot fetch its script fails silently and asynchronously,
// and the buffers must not be transferred into one that will never run.
self.postMessage({ type: "ready" });

self.onmessage = async (event) => {
  const { type, payload } = event.data;

  try {
    if (type === "parse") await parse(payload);
    else if (type === "slice") slice(payload);
  } catch (err) {
    self.postMessage({ type: "error", message: err?.message ?? String(err) });
  }
};

/**
 * @param {{files: Array<{name: string, bytes: ArrayBuffer}>}} payload
 */
async function parse({ files }) {
  terrain = new TerrainIndex();
  let tables = 0;
  let logs = 0;

  // .ldb first: the compacted tables hold the bulk, and any key the log also
  // carries is a newer write that should win, so the log is applied after.
  const ordered = [
    ...files.filter((f) => f.name.endsWith(".ldb")),
    ...files.filter((f) => f.name.endsWith(".log"))
  ];

  for (let i = 0; i < ordered.length; i++) {
    const file = ordered[i];
    const bytes = new Uint8Array(file.bytes);
    try {
      if (file.name.endsWith(".ldb")) {
        await readTable(bytes, (k, v) => terrain.offer(k, v));
        tables++;
      } else {
        readLog(bytes, (k, v) => terrain.offer(k, v));
        logs++;
      }
    } catch (err) {
      // One unreadable table should not lose the rest of the world.
      self.postMessage({ type: "warn", message: `${file.name}: ${err.message}` });
    }
    self.postMessage({ type: "progress", done: i + 1, total: ordered.length });
  }

  self.postMessage({
    type: "parsed",
    chunks: terrain.chunkCount,
    subchunks: terrain.stats.subchunks,
    skipped: terrain.stats.skipped,
    bounds: terrain.bounds,
    tables,
    logs
  });
}

/** Pulls one bounded region out of the parsed world. */
function slice(opts) {
  if (!terrain) {
    self.postMessage({ type: "error", message: "No world parsed yet." });
    return;
  }

  const cells = terrain.surfaceCells(opts);

  // subarray views share the parent buffer, so they are copied into exactly
  // sized arrays before transfer - otherwise the whole grown capacity travels.
  const x = new Int32Array(cells.x);
  const y = new Int32Array(cells.y);
  const z = new Int32Array(cells.z);
  const id = new Uint16Array(cells.id);

  self.postMessage(
    {
      type: "slice",
      count: cells.count,
      truncated: cells.truncated,
      names: cells.names,
      x, y, z, id
    },
    [x.buffer, y.buffer, z.buffer, id.buffer]
  );
}
