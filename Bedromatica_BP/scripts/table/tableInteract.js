/**
 * Bedromatica - Schem Table block interaction.
 *
 * Right-clicking the table with a charged wand opens the Schem Table screen.
 * Anything else gets a nudge in the action bar and no screen.
 */

import { world } from "@minecraft/server";
import { BLOCK_TABLE } from "../utils/constants.js";
import { getMainHand, isWand, isChargedWand } from "../utils/nbtStorage.js";
import { openSchemTable } from "./tableUIHandler.js";

function actionBar(player, text) {
  try {
    player.onScreenDisplay.setActionBar(text);
  } catch {
    /* screen not available this tick */
  }
}

export function registerTableInteraction() {
  world.afterEvents.playerInteractWithBlock.subscribe((event) => {
    // The engine fires this twice per click on some platforms; the second
    // pass carries isFirstEvent === false.
    if (event.isFirstEvent === false) return;

    const { player, block } = event;
    if (!player || !block) return;

    let typeId;
    try {
      typeId = block.typeId;
    } catch {
      return; // block was broken between the click and this callback
    }
    if (typeId !== BLOCK_TABLE) return;

    const held = getMainHand(player);

    if (!isWand(held)) {
      actionBar(player, "§cPlace a charged Schem Wand first.");
      return;
    }

    if (!isChargedWand(held)) {
      actionBar(
        player,
        "§cPlace a charged Schem Wand first.\n§7Select a region with the wand to charge it."
      );
      return;
    }

    openSchemTable(player, block.location);
  });
}
