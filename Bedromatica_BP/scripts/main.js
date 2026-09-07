/**
 * Bedromatica - entry point.
 *
 * A Bedrock port of Litematica's capture half: select a region with the Schem
 * Wand, then feed the wand to a Schem Table to write the region out as an
 * .mcstructure through the StructureManager API.
 *
 * Targets @minecraft/server 1.19.0 and @minecraft/server-ui 1.3.0, the stable
 * modules shipped with Minecraft Bedrock 1.21.80 (engine 26.13). No beta APIs
 * and no experiments are required.
 */

import { world, system } from "@minecraft/server";
import { BLOCK_TABLE } from "./utils/constants.js";
import { getMainHand, isWand } from "./utils/nbtStorage.js";
import { handleWandUseOnBlock } from "./wand/wandHandler.js";
import {
  startSelectionRenderer,
  clearAbandonedSelections,
  forgetPlayer
} from "./wand/selectionBox.js";
import { registerTableInteraction } from "./table/tableInteract.js";
import { registerScriptEvents } from "./table/tableUIHandler.js";

/**
 * The engine can deliver two interact events for a single click, both inside
 * the same tick. Remember the last click per player and drop an identical one
 * that arrives before the next tick has finished.
 *
 * The window is deliberately tiny: marking pos1 and pos2 on the *same* block
 * is a legal 1x1x1 selection, so a real second click must always get through.
 * @type {Map<string, {key: string, tick: number}>}
 */
const lastClick = new Map();
const CLICK_COOLDOWN_TICKS = 2;

function isDuplicateClick(playerId, pos) {
  const key = `${pos.x},${pos.y},${pos.z}`;
  const previous = lastClick.get(playerId);
  const tick = system.currentTick;

  if (previous && previous.key === key && tick - previous.tick < CLICK_COOLDOWN_TICKS) {
    return true;
  }
  lastClick.set(playerId, { key, tick });
  return false;
}

/* ------------------------------------------------------------------ *
 * Wand clicks
 * ------------------------------------------------------------------ */

/**
 * Runs the wand logic one tick later, from a context where the world can be
 * written to. The held stack is re-read there rather than trusted from the
 * event, so the wand that gets modified is always the one actually in hand.
 */
function dispatchWandUse(player, position) {
  system.run(() => {
    try {
      const held = getMainHand(player);
      if (!isWand(held)) return;
      handleWandUseOnBlock(player, position, held);
    } catch (err) {
      console.warn(`[Bedromatica] wand use failed: ${err?.message ?? err}`);
    }
  });
}

function registerWandInteraction() {
  const beforeInteract = world.beforeEvents.playerInteractWithBlock;

  if (beforeInteract) {
    beforeInteract.subscribe((event) => {
      const { player, block, itemStack } = event;
      if (!player || !block || !isWand(itemStack)) return;

      // Clicks on the table belong to tableInteract; let them through
      // untouched so the after-event still fires.
      if (block.typeId === BLOCK_TABLE) return;

      // Suppress the vanilla interaction (placing, opening containers) so the
      // wand only ever marks corners.
      event.cancel = true;

      const position = {
        x: block.location.x,
        y: block.location.y,
        z: block.location.z
      };
      if (isDuplicateClick(player.id, position)) return;

      dispatchWandUse(player, position);
    });
    return;
  }

  // Older surface: itemUseOn carries the same information under other names.
  const beforeUseOn = world.beforeEvents.itemUseOn;
  if (!beforeUseOn) {
    console.warn("[Bedromatica] no usable block-interaction event; the wand will not respond.");
    return;
  }

  beforeUseOn.subscribe((event) => {
    const player = event.source;
    if (player?.typeId !== "minecraft:player") return;
    if (!isWand(event.itemStack)) return;

    const position = {
      x: event.block.location.x,
      y: event.block.location.y,
      z: event.block.location.z
    };
    if (event.block.typeId === BLOCK_TABLE) return;

    event.cancel = true;
    if (isDuplicateClick(player.id, position)) return;

    dispatchWandUse(player, position);
  });
}

/* ------------------------------------------------------------------ *
 * Player lifecycle
 * ------------------------------------------------------------------ */

function registerPlayerLifecycle() {
  world.afterEvents.playerSpawn.subscribe((event) => {
    if (!event.initialSpawn) return;
    // A player who logged out mid-selection comes back with a clean wand.
    system.run(() => {
      try {
        clearAbandonedSelections(event.player);
      } catch {
        /* player left again immediately */
      }
    });
  });

  world.afterEvents.playerLeave.subscribe((event) => {
    forgetPlayer(event.playerId);
    lastClick.delete(event.playerId);
  });
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

registerWandInteraction();
registerTableInteraction();
registerPlayerLifecycle();
registerScriptEvents();
startSelectionRenderer();

/**
 * Dynamic properties need no registration on this API level; the world event
 * is used only to confirm the pack came up. `worldLoad` is the 2.x name for
 * the same event, so whichever exists is fine.
 */
const worldReady = world.afterEvents.worldLoad ?? world.afterEvents.worldInitialize;
worldReady?.subscribe(() => {
  console.log("[Bedromatica] ready - Schem Wand and Schem Table are active.");
});
