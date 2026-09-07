/**
 * Bedromatica - selection outline renderer.
 *
 * Draws the 12 edges of the selection as a dotted wireframe out of
 * `bedromatica:selection_line` particles. Two modes:
 *
 *   preview  cyan, pos1 -> whatever block the crosshair is on, refreshed
 *            every 2 ticks so the box grows as the player looks around
 *   locked   blue, pos1 -> pos2, refreshed every 5 ticks
 *
 * The particles are one-shot with a 0.4s lifetime, so "despawning" is simply a
 * matter of not emitting any more: swapping items, sheathing the wand to the
 * off-hand or resetting it makes the box fade within half a second.
 */

import { world, system, MolangVariableMap } from "@minecraft/server";
import {
  PARTICLE_SELECTION,
  PREVIEW_REFRESH_TICKS,
  LOCKED_REFRESH_TICKS,
  DOT_SPACING,
  MAX_DOTS_PER_BOX,
  RAYCAST_DISTANCE
} from "../utils/constants.js";
import {
  getMainHand,
  getOffHand,
  setOffHand,
  getInventory,
  isWand,
  isChargedWand,
  isEmptyWand,
  readSelection,
  clearSelection,
  clearPlayerMirror,
  mirrorToPlayer
} from "../utils/nbtStorage.js";
import { normalizeRegion, discardStructure } from "./structureCapture.js";

/** Furthest a dot may be from the viewer before it is skipped. */
const RENDER_DISTANCE = 96;
const RENDER_DISTANCE_SQ = RENDER_DISTANCE * RENDER_DISTANCE;

const PREVIEW_TINT = new MolangVariableMap();
PREVIEW_TINT.setFloat("locked", 0);

const LOCKED_TINT = new MolangVariableMap();
LOCKED_TINT.setFloat("locked", 1);

/**
 * Per-player render state. Keyed by player id so two players selecting at the
 * same time never see each other's box.
 * @type {Map<string, {mode: "preview"|"locked", nextRender: number}>}
 */
const sessions = new Map();

let intervalHandle;

/* ------------------------------------------------------------------ *
 * Geometry
 * ------------------------------------------------------------------ */

/**
 * The 12 edges of the block-aligned box, expressed in world coordinates.
 * A region from min to max inclusive spans min .. max+1 in world space.
 */
function boxEdges(min, max) {
  const lo = { x: min.x, y: min.y, z: min.z };
  const hi = { x: max.x + 1, y: max.y + 1, z: max.z + 1 };

  const corners = [
    [lo.x, lo.y, lo.z], [hi.x, lo.y, lo.z], [hi.x, lo.y, hi.z], [lo.x, lo.y, hi.z],
    [lo.x, hi.y, lo.z], [hi.x, hi.y, lo.z], [hi.x, hi.y, hi.z], [lo.x, hi.y, hi.z]
  ];

  const pairs = [
    [0, 1], [1, 2], [2, 3], [3, 0], // bottom face
    [4, 5], [5, 6], [6, 7], [7, 4], // top face
    [0, 4], [1, 5], [2, 6], [3, 7]  // uprights
  ];

  return pairs.map(([a, b]) => [corners[a], corners[b]]);
}

/**
 * Dot spacing is widened for large selections so a maximum-size region costs
 * roughly the same as a small one.
 */
function spacingFor(min, max) {
  const spanX = max.x - min.x + 1;
  const spanY = max.y - min.y + 1;
  const spanZ = max.z - min.z + 1;
  const totalEdgeLength = 4 * (spanX + spanY + spanZ);
  const wanted = totalEdgeLength / MAX_DOTS_PER_BOX;
  return Math.max(DOT_SPACING, wanted);
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

function renderBox(player, dimension, min, max, locked) {
  const spacing = spacingFor(min, max);
  const tint = locked ? LOCKED_TINT : PREVIEW_TINT;
  const eye = player.location;

  try {
    for (const [start, end] of boxEdges(min, max)) {
      const dx = end[0] - start[0];
      const dy = end[1] - start[1];
      const dz = end[2] - start[2];
      const length = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
      const steps = Math.max(1, Math.round(length / spacing));

      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const point = {
          x: start[0] + dx * t,
          y: start[1] + dy * t,
          z: start[2] + dz * t
        };

        const ox = point.x - eye.x;
        const oy = point.y - eye.y;
        const oz = point.z - eye.z;
        if (ox * ox + oy * oy + oz * oz > RENDER_DISTANCE_SQ) continue;

        dimension.spawnParticle(PARTICLE_SELECTION, point, tint);
      }
    }
  } catch {
    // Chunk unloaded underneath us, or the player changed dimension between
    // the state read and the spawn. Nothing to do but skip this refresh.
  }
}

/* ------------------------------------------------------------------ *
 * Abandoned-selection cleanup
 * ------------------------------------------------------------------ */

/**
 * Wipes a half-finished selection (pos1 with no capture behind it) from every
 * blank wand the player is carrying. Runs once on the tick the wand leaves the
 * main hand, and again when they rejoin the world.
 */
export function clearAbandonedSelections(player) {
  const container = getInventory(player);
  if (container) {
    for (let slot = 0; slot < container.size; slot++) {
      let stack;
      try {
        stack = container.getItem(slot);
      } catch {
        continue;
      }
      if (!isEmptyWand(stack)) continue;

      const sel = readSelection(stack);
      if (!sel.pos1 && !sel.pos2 && !sel.structureId) continue;

      discardStructure(sel.structureId);
      clearSelection(stack);
      try {
        container.setItem(slot, stack);
      } catch {
        /* slot vanished mid-scan */
      }
    }
  }

  const offHand = getOffHand(player);
  if (isEmptyWand(offHand)) {
    const sel = readSelection(offHand);
    if (sel.pos1 || sel.pos2 || sel.structureId) {
      discardStructure(sel.structureId);
      clearSelection(offHand);
      setOffHand(player, offHand);
    }
  }

  clearPlayerMirror(player);
}

/* ------------------------------------------------------------------ *
 * Tick loop
 * ------------------------------------------------------------------ */

function tickPlayer(player, tick) {
  const held = getMainHand(player);

  if (!isWand(held)) {
    // Wand left the main hand: stop drawing and drop any unfinished selection.
    if (sessions.has(player.id)) {
      sessions.delete(player.id);
      clearAbandonedSelections(player);
    }
    return;
  }

  const sel = readSelection(held);
  const charged = isChargedWand(held);
  const mode = charged ? "locked" : "preview";

  let session = sessions.get(player.id);
  if (!session || session.mode !== mode) {
    session = { mode, nextRender: 0 };
    sessions.set(player.id, session);
    mirrorToPlayer(player, sel, charged);
  }

  if (tick < session.nextRender) return;

  if (charged) {
    if (!sel.pos1 || !sel.pos2) return;
    const { min, max } = normalizeRegion(sel.pos1, sel.pos2);
    renderBox(player, player.dimension, min, max, true);
    session.nextRender = tick + LOCKED_REFRESH_TICKS;
    return;
  }

  // Blank wand: only draw once pos1 has been planted.
  if (!sel.pos1) return;

  let target = sel.pos2;
  if (!target) {
    const hit = player.getBlockFromViewDirection({
      maxDistance: RAYCAST_DISTANCE,
      includeLiquidBlocks: false,
      includePassableBlocks: false
    });
    target = hit?.block?.location;
  }
  if (!target) target = sel.pos1;

  const { min, max } = normalizeRegion(sel.pos1, target);
  renderBox(player, player.dimension, min, max, false);
  session.nextRender = tick + PREVIEW_REFRESH_TICKS;
}

/** Starts the renderer. Safe to call more than once. */
export function startSelectionRenderer() {
  if (intervalHandle !== undefined) return;

  let tick = 0;
  intervalHandle = system.runInterval(() => {
    tick++;
    for (const player of world.getAllPlayers()) {
      try {
        tickPlayer(player, tick);
      } catch {
        // One bad player must not take the whole render loop down.
      }
    }
  }, 1);
}

/**
 * Drops a player's cached render state. Used when they leave, and after a
 * click changes the selection so the next tick re-reads the wand instead of
 * drawing a stale box.
 */
export function forgetPlayer(playerId) {
  sessions.delete(playerId);
}
