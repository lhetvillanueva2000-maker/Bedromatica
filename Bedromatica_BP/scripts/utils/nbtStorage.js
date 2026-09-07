/**
 * Bedromatica - persistence helpers for wand data.
 *
 * STORAGE CHOICE
 * --------------
 * Item-level dynamic properties are the source of truth. `ItemStack` has
 * carried `getDynamicProperty` / `setDynamicProperty` since @minecraft/server
 * 1.9.0 and they are stable on the 1.x track this pack targets, so the
 * selection travels with the wand: drop it, trade it, put it in a shulker box
 * and the captured region is still attached to that exact stack rather than to
 * whoever happened to click first.
 *
 * The four player-level properties named in the design doc are still written,
 * as a mirror of whatever wand is currently in the main hand. The renderer and
 * the `bedromatica:debug` script event read the mirror so neither has to reach
 * into inventories every tick. `mirrorToPlayer` / `clearPlayerMirror` are the
 * only writers, which keeps the two copies from drifting apart.
 *
 * Dynamic properties need no registration on this API level - the
 * `propertyRegistry` step disappeared in @minecraft/server 1.7.0.
 */

import { EquipmentSlot } from "@minecraft/server";
import {
  ITEM_WAND,
  ITEM_WAND_CHARGED,
  PROP_POS1,
  PROP_POS2,
  PROP_HAS_DATA,
  PROP_STRUCTURE_ID,
  PROP_DIMENSION
} from "./constants.js";

/* ------------------------------------------------------------------ *
 * Vector serialisation
 * ------------------------------------------------------------------ */

/** @param {{x:number,y:number,z:number}} vec */
export function encodeVec(vec) {
  return JSON.stringify({
    x: Math.floor(vec.x),
    y: Math.floor(vec.y),
    z: Math.floor(vec.z)
  });
}

/**
 * @param {unknown} raw
 * @returns {{x:number,y:number,z:number}|undefined}
 */
export function decodeVec(raw) {
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.x !== "number" ||
      typeof parsed?.y !== "number" ||
      typeof parsed?.z !== "number"
    ) {
      return undefined;
    }
    return { x: parsed.x, y: parsed.y, z: parsed.z };
  } catch {
    return undefined;
  }
}

export function formatVec(vec) {
  return `(${vec.x}, ${vec.y}, ${vec.z})`;
}

export function sameVec(a, b) {
  return !!a && !!b && a.x === b.x && a.y === b.y && a.z === b.z;
}

/* ------------------------------------------------------------------ *
 * Item identification
 * ------------------------------------------------------------------ */

export function isWand(stack) {
  return (
    stack?.typeId === ITEM_WAND || stack?.typeId === ITEM_WAND_CHARGED
  );
}

export function isChargedWand(stack) {
  return stack?.typeId === ITEM_WAND_CHARGED;
}

export function isEmptyWand(stack) {
  return stack?.typeId === ITEM_WAND;
}

/* ------------------------------------------------------------------ *
 * Hand access
 * ------------------------------------------------------------------ */

function equippable(player) {
  try {
    return player.getComponent("minecraft:equippable");
  } catch {
    return undefined;
  }
}

/** @returns {import("@minecraft/server").ItemStack|undefined} */
export function getMainHand(player) {
  try {
    return equippable(player)?.getEquipment(EquipmentSlot.Mainhand);
  } catch {
    return undefined;
  }
}

/** @returns {import("@minecraft/server").ItemStack|undefined} */
export function getOffHand(player) {
  try {
    return equippable(player)?.getEquipment(EquipmentSlot.Offhand);
  } catch {
    return undefined;
  }
}

/**
 * Writes a stack back into the main hand. Every ItemStack handed out by the
 * API is a copy, so nothing persists until this runs.
 * @returns {boolean} whether the write landed
 */
export function setMainHand(player, stack) {
  const comp = equippable(player);
  if (!comp) return false;
  try {
    comp.setEquipment(EquipmentSlot.Mainhand, stack);
    return true;
  } catch {
    return false;
  }
}

/** Writes a stack back into the off-hand slot. */
export function setOffHand(player, stack) {
  const comp = equippable(player);
  if (!comp) return false;
  try {
    comp.setEquipment(EquipmentSlot.Offhand, stack);
    return true;
  } catch {
    return false;
  }
}

/** @returns {import("@minecraft/server").Container|undefined} */
export function getInventory(player) {
  try {
    return player.getComponent("minecraft:inventory")?.container;
  } catch {
    return undefined;
  }
}

/* ------------------------------------------------------------------ *
 * Selection data on the wand itself
 * ------------------------------------------------------------------ */

/**
 * @typedef {object} Selection
 * @property {{x:number,y:number,z:number}|undefined} pos1
 * @property {{x:number,y:number,z:number}|undefined} pos2
 * @property {string|undefined} structureId
 * @property {string|undefined} dimensionId
 */

/**
 * @param {import("@minecraft/server").ItemStack|undefined} stack
 * @returns {Selection}
 */
export function readSelection(stack) {
  if (!stack) return { pos1: undefined, pos2: undefined, structureId: undefined, dimensionId: undefined };
  const structureId = stack.getDynamicProperty(PROP_STRUCTURE_ID);
  const dimensionId = stack.getDynamicProperty(PROP_DIMENSION);
  return {
    pos1: decodeVec(stack.getDynamicProperty(PROP_POS1)),
    pos2: decodeVec(stack.getDynamicProperty(PROP_POS2)),
    structureId: typeof structureId === "string" && structureId ? structureId : undefined,
    dimensionId: typeof dimensionId === "string" && dimensionId ? dimensionId : undefined
  };
}

/**
 * Applies a partial selection to a stack. Pass `undefined` for a field to
 * leave it alone and `null` to erase it.
 * @param {import("@minecraft/server").ItemStack} stack
 * @param {{pos1?:any, pos2?:any, structureId?:string|null, dimensionId?:string|null}} patch
 */
export function writeSelection(stack, patch) {
  if (!stack) return;
  if (patch.pos1 !== undefined) {
    stack.setDynamicProperty(PROP_POS1, patch.pos1 === null ? undefined : encodeVec(patch.pos1));
  }
  if (patch.pos2 !== undefined) {
    stack.setDynamicProperty(PROP_POS2, patch.pos2 === null ? undefined : encodeVec(patch.pos2));
  }
  if (patch.structureId !== undefined) {
    stack.setDynamicProperty(PROP_STRUCTURE_ID, patch.structureId === null ? undefined : patch.structureId);
  }
  if (patch.dimensionId !== undefined) {
    stack.setDynamicProperty(PROP_DIMENSION, patch.dimensionId === null ? undefined : patch.dimensionId);
  }
}

/** Strips every Bedromatica property from a stack, leaving a blank wand. */
export function clearSelection(stack) {
  if (!stack) return;
  stack.setDynamicProperty(PROP_POS1, undefined);
  stack.setDynamicProperty(PROP_POS2, undefined);
  stack.setDynamicProperty(PROP_STRUCTURE_ID, undefined);
  stack.setDynamicProperty(PROP_DIMENSION, undefined);
}

/**
 * Copies Bedromatica properties from one stack onto another. Used when the
 * held wand is swapped between the empty and charged item definitions.
 */
export function copySelection(from, to) {
  const sel = readSelection(from);
  writeSelection(to, {
    pos1: sel.pos1 ?? null,
    pos2: sel.pos2 ?? null,
    structureId: sel.structureId ?? null,
    dimensionId: sel.dimensionId ?? null
  });
}

/* ------------------------------------------------------------------ *
 * Player-side mirror
 * ------------------------------------------------------------------ */

/**
 * @param {import("@minecraft/server").Player} player
 * @param {Selection} sel
 * @param {boolean} hasData
 */
export function mirrorToPlayer(player, sel, hasData) {
  try {
    player.setDynamicProperty(PROP_POS1, sel.pos1 ? encodeVec(sel.pos1) : "");
    player.setDynamicProperty(PROP_POS2, sel.pos2 ? encodeVec(sel.pos2) : "");
    player.setDynamicProperty(PROP_STRUCTURE_ID, sel.structureId ?? "");
    player.setDynamicProperty(PROP_DIMENSION, sel.dimensionId ?? "");
    player.setDynamicProperty(PROP_HAS_DATA, hasData === true);
  } catch {
    /* player left mid-tick; the mirror is rebuilt on their next wand use */
  }
}

/** @returns {{sel: Selection, hasData: boolean}} */
export function readPlayerMirror(player) {
  const structureId = player.getDynamicProperty(PROP_STRUCTURE_ID);
  const dimensionId = player.getDynamicProperty(PROP_DIMENSION);
  return {
    sel: {
      pos1: decodeVec(player.getDynamicProperty(PROP_POS1)),
      pos2: decodeVec(player.getDynamicProperty(PROP_POS2)),
      structureId: typeof structureId === "string" && structureId ? structureId : undefined,
      dimensionId: typeof dimensionId === "string" && dimensionId ? dimensionId : undefined
    },
    hasData: player.getDynamicProperty(PROP_HAS_DATA) === true
  };
}

export function clearPlayerMirror(player) {
  try {
    player.setDynamicProperty(PROP_POS1, "");
    player.setDynamicProperty(PROP_POS2, "");
    player.setDynamicProperty(PROP_STRUCTURE_ID, "");
    player.setDynamicProperty(PROP_DIMENSION, "");
    player.setDynamicProperty(PROP_HAS_DATA, false);
  } catch {
    /* nothing to clear if the player is already gone */
  }
}
