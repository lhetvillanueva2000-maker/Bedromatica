/**
 * Bedromatica - Schem Wand click logic.
 *
 * First use-on-block plants pos1 and starts the live preview box. The second
 * plants pos2, captures the region through the StructureManager and hands the
 * player back a charged (glinting) wand carrying that snapshot. Sneak-use at
 * any point wipes the wand back to blank.
 */

import { ItemStack } from "@minecraft/server";
import { ITEM_WAND, ITEM_WAND_CHARGED } from "../utils/constants.js";
import {
  readSelection,
  writeSelection,
  copySelection,
  isChargedWand,
  setMainHand,
  mirrorToPlayer,
  clearPlayerMirror,
  formatVec
} from "../utils/nbtStorage.js";
import {
  captureRegion,
  discardStructure,
  normalizeRegion
} from "./structureCapture.js";
import { forgetPlayer } from "./selectionBox.js";

function actionBar(player, text) {
  try {
    player.onScreenDisplay.setActionBar(text);
  } catch {
    /* screen not available this tick */
  }
}

/* ------------------------------------------------------------------ *
 * Stack construction
 * ------------------------------------------------------------------ */

/** A blank wand, carrying nothing but the player's custom name. */
export function makeBlankWand(previous) {
  const stack = new ItemStack(ITEM_WAND, 1);
  if (previous?.nameTag) stack.nameTag = previous.nameTag;
  return stack;
}

/**
 * A charged wand holding the given selection. The glint comes from the
 * `bedromatica:schem_wand_charged` definition rather than from a runtime
 * component edit, which Bedrock does not support.
 */
export function makeChargedWand(previous, selection) {
  const stack = new ItemStack(ITEM_WAND_CHARGED, 1);
  if (previous?.nameTag) stack.nameTag = previous.nameTag;
  copySelection(previous, stack);
  writeSelection(stack, selection);

  const sel = readSelection(stack);
  if (sel.pos1 && sel.pos2) {
    const { size } = normalizeRegion(sel.pos1, sel.pos2);
    stack.setLore([
      `§7Pos1 §f${formatVec(sel.pos1)}`,
      `§7Pos2 §f${formatVec(sel.pos2)}`,
      `§7Size §f${size.x} x ${size.y} x ${size.z}`
    ]);
  }
  return stack;
}

/* ------------------------------------------------------------------ *
 * Reset
 * ------------------------------------------------------------------ */

/**
 * Clears pos1/pos2, throws away the snapshot, removes the glint and puts a
 * blank wand back in the player's hand.
 */
export function resetWand(player, held, announce = true) {
  const sel = readSelection(held);
  discardStructure(sel.structureId);

  setMainHand(player, makeBlankWand(held));
  clearPlayerMirror(player);
  forgetPlayer(player.id);

  if (announce) actionBar(player, "§7Wand reset.");
}

/* ------------------------------------------------------------------ *
 * Use-on-block
 * ------------------------------------------------------------------ */

/**
 * @param {import("@minecraft/server").Player} player
 * @param {{x:number,y:number,z:number}} clicked location of the clicked block
 * @param {import("@minecraft/server").ItemStack} held the wand, as read this tick
 */
export function handleWandUseOnBlock(player, clicked, held) {
  if (player.isSneaking) {
    resetWand(player, held);
    return;
  }

  const pos = {
    x: Math.floor(clicked.x),
    y: Math.floor(clicked.y),
    z: Math.floor(clicked.z)
  };

  if (isChargedWand(held)) {
    actionBar(
      player,
      "§eWand already holds a selection.\n§7Use a Schem Table to save it, or sneak-use to reset."
    );
    return;
  }

  const sel = readSelection(held);

  /* ---- first click: plant pos1 ---- */
  if (!sel.pos1) {
    writeSelection(held, {
      pos1: pos,
      pos2: null,
      structureId: null,
      dimensionId: player.dimension.id
    });
    setMainHand(player, held);
    mirrorToPlayer(player, { pos1: pos, dimensionId: player.dimension.id }, false);
    forgetPlayer(player.id);

    actionBar(player, `§bPos1 set: §f${formatVec(pos)}`);
    return;
  }

  /* ---- selection started in another dimension ---- */
  if (sel.dimensionId && sel.dimensionId !== player.dimension.id) {
    writeSelection(held, {
      pos1: pos,
      pos2: null,
      structureId: null,
      dimensionId: player.dimension.id
    });
    setMainHand(player, held);
    mirrorToPlayer(player, { pos1: pos, dimensionId: player.dimension.id }, false);
    forgetPlayer(player.id);

    actionBar(
      player,
      `§ePos1 was set in another dimension.\n§bPos1 set: §f${formatVec(pos)}`
    );
    return;
  }

  /* ---- second click: plant pos2 and capture ---- */
  const result = captureRegion(player.dimension, sel.pos1, pos);

  if (!result.ok) {
    // Failed capture leaves nothing behind: no glint, no stored corners.
    setMainHand(player, makeBlankWand(held));
    clearPlayerMirror(player);
    forgetPlayer(player.id);

    actionBar(player, `§cSelected Unsuccessfully\n§7${result.error}`);
    return;
  }

  const charged = makeChargedWand(held, {
    pos1: sel.pos1,
    pos2: pos,
    structureId: result.structureId,
    dimensionId: player.dimension.id
  });

  if (!setMainHand(player, charged)) {
    // Could not hand the charged wand back; do not leave an orphan snapshot.
    discardStructure(result.structureId);
    actionBar(player, "§cSelected Unsuccessfully\n§7Could not update the wand.");
    return;
  }

  mirrorToPlayer(
    player,
    {
      pos1: sel.pos1,
      pos2: pos,
      structureId: result.structureId,
      dimensionId: player.dimension.id
    },
    true
  );
  forgetPlayer(player.id);

  const { size } = result;
  actionBar(
    player,
    `§bPos2 set: §f${formatVec(pos)}\n§aSelected Successfully §7(${size.x}x${size.y}x${size.z})`
  );
}
