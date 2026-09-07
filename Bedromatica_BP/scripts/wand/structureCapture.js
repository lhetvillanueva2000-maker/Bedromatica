/**
 * Bedromatica - region validation and .mcstructure capture.
 *
 * All saving goes through `world.structureManager`. Structures written with
 * `StructureSaveMode.World` land in the world save exactly as `/structure save`
 * writes them, which is what makes them readable as `.mcstructure` files.
 * `player.runCommand("structure save ...")` exists only as a last-ditch
 * fallback for the rename step and is never the primary path.
 */

import { world, StructureSaveMode } from "@minecraft/server";
import {
  MAX_STRUCTURE_X,
  MAX_STRUCTURE_Y,
  MAX_STRUCTURE_Z,
  MAX_NAME_LENGTH,
  STRUCTURE_NAMESPACE,
  TEMP_STRUCTURE_NAMESPACE
} from "../utils/constants.js";

/* ------------------------------------------------------------------ *
 * Region maths
 * ------------------------------------------------------------------ */

/**
 * Turns two arbitrary corners into an inclusive min/max pair plus its size.
 * Clicking the same block twice yields a legal 1x1x1 region.
 */
export function normalizeRegion(a, b) {
  const min = {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    z: Math.min(a.z, b.z)
  };
  const max = {
    x: Math.max(a.x, b.x),
    y: Math.max(a.y, b.y),
    z: Math.max(a.z, b.z)
  };
  return {
    min,
    max,
    size: {
      x: max.x - min.x + 1,
      y: max.y - min.y + 1,
      z: max.z - min.z + 1
    }
  };
}

export function regionVolume(size) {
  return size.x * size.y * size.z;
}

/**
 * @returns {{ok: true} | {ok: false, error: string}}
 */
export function validateRegion(dimension, min, max, size) {
  if (size.x > MAX_STRUCTURE_X || size.z > MAX_STRUCTURE_Z) {
    return {
      ok: false,
      error: `Region is ${size.x}x${size.z} wide; the limit is ${MAX_STRUCTURE_X}x${MAX_STRUCTURE_Z}.`
    };
  }
  if (size.y > MAX_STRUCTURE_Y) {
    return {
      ok: false,
      error: `Region is ${size.y} tall; the limit is ${MAX_STRUCTURE_Y}.`
    };
  }

  const range = dimension.heightRange;
  if (range && (min.y < range.min || max.y > range.max)) {
    return {
      ok: false,
      error: `Region leaves the buildable range (${range.min} to ${range.max}).`
    };
  }

  // Reading a block in an unloaded chunk either returns undefined or throws,
  // depending on version. Both mean the same thing here: nothing to capture.
  const corners = [
    { x: min.x, y: min.y, z: min.z },
    { x: max.x, y: min.y, z: min.z },
    { x: min.x, y: min.y, z: max.z },
    { x: max.x, y: min.y, z: max.z },
    { x: min.x, y: max.y, z: min.z },
    { x: max.x, y: max.y, z: min.z },
    { x: min.x, y: max.y, z: max.z },
    { x: max.x, y: max.y, z: max.z }
  ];
  for (const corner of corners) {
    let block;
    try {
      block = dimension.getBlock(corner);
    } catch {
      block = undefined;
    }
    if (!block) {
      return { ok: false, error: "Part of the region is in an unloaded chunk." };
    }
  }

  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * Identifiers
 * ------------------------------------------------------------------ */

/**
 * Structure identifiers accept lowercase alphanumerics plus `_ - .` only, so
 * whatever the player typed is folded into that alphabet rather than rejected
 * outright.
 * @returns {{ok: true, name: string} | {ok: false, error: string}}
 */
export function sanitizeName(raw) {
  if (typeof raw !== "string") return { ok: false, error: "No name was entered." };

  const name = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-. ]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^[_\-.]+|[_\-.]+$/g, "")
    .slice(0, MAX_NAME_LENGTH);

  if (name.length === 0) {
    return { ok: false, error: "Name must contain at least one letter or digit." };
  }
  return { ok: true, name };
}

let tempCounter = 0;

/** Unique-per-capture identifier for the snapshot the wand carries. */
export function makeTempId() {
  tempCounter = (tempCounter + 1) % 100000;
  return `${TEMP_STRUCTURE_NAMESPACE}:temp_${Date.now().toString(36)}_${tempCounter}`;
}

export function makeFinalId(name) {
  return `${STRUCTURE_NAMESPACE}:${name}`;
}

/* ------------------------------------------------------------------ *
 * Capture
 * ------------------------------------------------------------------ */

/**
 * Saves the region between two corners under a throwaway identifier.
 * @returns {{ok: true, structureId: string, size: object} | {ok: false, error: string}}
 */
export function captureRegion(dimension, pos1, pos2) {
  const { min, max, size } = normalizeRegion(pos1, pos2);

  const check = validateRegion(dimension, min, max, size);
  if (!check.ok) return check;

  const structureId = makeTempId();
  try {
    world.structureManager.createFromWorld(structureId, dimension, min, max, {
      saveMode: StructureSaveMode.World,
      includeBlocks: true,
      includeEntities: false
    });
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }

  return { ok: true, structureId, size };
}

/**
 * Re-files an already captured snapshot under its final `mystructure:` name.
 *
 * `Structure.saveAs` is the cheap path - it copies what the wand already holds
 * and never touches the world, so it works even when the player walked far
 * away from the selection. If that is unavailable the region is captured a
 * second time, and only if that also fails does the command form get a turn.
 *
 * @returns {{ok: true, finalId: string} | {ok: false, error: string}}
 */
export function finalizeCapture(player, dimension, sel, name) {
  const finalId = makeFinalId(name);

  // `/structure save` overwrites by name; match that instead of erroring out.
  try {
    if (world.structureManager.get(finalId)) {
      world.structureManager.delete(finalId);
    }
  } catch {
    /* nothing filed under that name yet */
  }

  // 1. copy the snapshot the wand is carrying
  if (sel.structureId) {
    try {
      const snapshot = world.structureManager.get(sel.structureId);
      if (snapshot && typeof snapshot.saveAs === "function") {
        try {
          snapshot.saveAs(finalId, StructureSaveMode.World);
        } catch {
          // Older signature takes the identifier only.
          snapshot.saveAs(finalId);
        }
        return { ok: true, finalId };
      }
    } catch (err) {
      console.warn(`[Bedromatica] saveAs failed for ${finalId}: ${describeError(err)}`);
    }
  }

  // 2. read the region out of the world again
  if (sel.pos1 && sel.pos2) {
    const { min, max, size } = normalizeRegion(sel.pos1, sel.pos2);
    const check = validateRegion(dimension, min, max, size);
    if (check.ok) {
      try {
        world.structureManager.createFromWorld(finalId, dimension, min, max, {
          saveMode: StructureSaveMode.World,
          includeBlocks: true,
          includeEntities: false
        });
        return { ok: true, finalId };
      } catch (err) {
        console.warn(`[Bedromatica] createFromWorld failed for ${finalId}: ${describeError(err)}`);
      }
    }

    // 3. last resort: the command form, which runs from the player's context
    try {
      player.runCommand(
        `structure save "${finalId}" ${min.x} ${min.y} ${min.z} ${max.x} ${max.y} ${max.z} disk false`
      );
      if (world.structureManager.get(finalId)) {
        return { ok: true, finalId };
      }
    } catch (err) {
      console.warn(`[Bedromatica] structure save command failed: ${describeError(err)}`);
    }
  }

  return { ok: false, error: "The captured region could no longer be read." };
}

/** Removes a snapshot; safe to call with a stale or already-deleted id. */
export function discardStructure(structureId) {
  if (!structureId) return;
  try {
    world.structureManager.delete(structureId);
  } catch {
    /* already gone */
  }
}

export function describeError(err) {
  if (!err) return "Unknown error.";
  if (typeof err === "string") return err;
  return err.message ?? String(err);
}
