/**
 * The same terrain reader, on the main thread.
 *
 * Module workers need a WebView new enough to fetch a worker script through the
 * app's own asset interceptor. Nearly every phone has one; the handful that do
 * not would otherwise get a terrain card that never fills in. This stands in
 * for the worker with the identical message protocol, so nothing above it has
 * to know which one it is talking to.
 *
 * It is slower by design - the work is real and it is happening on the thread
 * that draws - so it yields between database files to keep the app responsive
 * rather than pretending the cost is not there.
 */

import { readTable, readLog } from "./leveldb.js";
import { TerrainIndex } from "./bedrock-world.js";

const yieldToUi = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * @param {(msg: object) => void} onMessage same handler the worker feeds
 * @returns {{postMessage: Function, terminate: Function}}
 */
export function createInlineTerrain(onMessage) {
  let terrain = null;
  let stopped = false;

  const post = (msg) => {
    if (!stopped) onMessage(msg);
  };

  async function parse({ files }) {
    terrain = new TerrainIndex();
    let tables = 0;
    let logs = 0;

    const ordered = [
      ...files.filter((f) => f.name.endsWith(".ldb")),
      ...files.filter((f) => f.name.endsWith(".log"))
    ];

    for (let i = 0; i < ordered.length && !stopped; i++) {
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
        post({ type: "warn", message: `${file.name}: ${err.message}` });
      }
      post({ type: "progress", done: i + 1, total: ordered.length });
      await yieldToUi();
    }
    if (stopped) return;

    post({
      type: "parsed",
      chunks: terrain.chunkCount,
      subchunks: terrain.stats.subchunks,
      skipped: terrain.stats.skipped,
      bounds: terrain.bounds,
      tables,
      logs
    });
  }

  function slice(opts) {
    if (!terrain) {
      post({ type: "error", message: "No world parsed yet." });
      return;
    }
    const cells = terrain.surfaceCells(opts);
    post({
      type: "slice",
      count: cells.count,
      truncated: cells.truncated,
      names: cells.names,
      x: cells.x,
      y: cells.y,
      z: cells.z,
      id: cells.id
    });
  }

  return {
    postMessage({ type, payload }) {
      // Deferred so the caller returns first, exactly as posting to a worker
      // would, and any error surfaces through the same channel.
      setTimeout(async () => {
        try {
          if (type === "parse") await parse(payload);
          else if (type === "slice") slice(payload);
        } catch (err) {
          post({ type: "error", message: err?.message ?? String(err) });
        }
      }, 0);
    },
    terminate() {
      stopped = true;
      terrain = null;
    }
  };
}
