/**
 * Bedromatica - Schem Table screen.
 *
 * SCRIPT <-> JSON UI COMMUNICATION: OPTION A (server-form bound JSON UI).
 * ----------------------------------------------------------------------
 * Bedrock has no API for opening a standalone JSON UI screen from script, and
 * JSON UI buttons cannot run commands, so "custom screen fires a scriptevent"
 * is not a route the engine offers on 1.21.80. What every shipping add-on does
 * instead - and what this pack does - is bind the custom screen to a server
 * form:
 *
 *   1. Script opens a `ModalFormData` whose title is the sentinel string
 *      `Bedromatica Schem Table` (see `constants.js`).
 *   2. `RP/ui/bedromatica_server_form.json` patches the vanilla `custom_form`
 *      and `long_form` layouts, adding controls that are bound to
 *      `#title_text` and therefore only draw for that exact title. The
 *      1408x768 artwork goes in behind the dialog and the CORE UNIT slot
 *      icons plus the diagnostics readout go over the top.
 *   3. The player types into the form's own text field and presses Confirm;
 *      the typed name comes back through `response.formValues[0]`.
 *
 * Because the interactive parts are the form's own controls, the screen keeps
 * working on any version - if a future release reshuffles the vanilla UI and
 * the artwork stops attaching, the fallback is a plain text prompt, not a
 * broken screen. Nothing here depends on vanilla element names.
 *
 * `bedromatica:confirm_save` is also accepted as a script event so the same
 * save path can be driven from a command block or another add-on.
 */

import { world, system } from "@minecraft/server";
import { ActionFormData, ModalFormData, FormCancelationReason } from "@minecraft/server-ui";
import {
  BLOCK_TABLE,
  FORM_TITLE_INPUT,
  FORM_TITLE_RESULT,
  MAX_NAME_LENGTH,
  STRUCTURE_FOLDER
} from "../utils/constants.js";
import {
  getMainHand,
  setMainHand,
  isChargedWand,
  readSelection,
  clearPlayerMirror,
  readPlayerMirror,
  formatVec
} from "../utils/nbtStorage.js";
import {
  sanitizeName,
  finalizeCapture,
  discardStructure,
  normalizeRegion,
  structureFilePath
} from "../wand/structureCapture.js";
import { makeBlankWand, resetWand } from "../wand/wandHandler.js";
import { forgetPlayer } from "../wand/selectionBox.js";

/** Players with the screen already open, so a double click cannot stack forms. */
const openScreens = new Set();

function actionBar(player, text) {
  try {
    player.onScreenDisplay.setActionBar(text);
  } catch {
    /* screen not available this tick */
  }
}

/** Promise-based tick delay built on `system.runTimeout`. */
function delay(ticks) {
  return new Promise((resolve) => system.runTimeout(resolve, ticks));
}

/**
 * Forms refuse to open while the player already has a screen up (chat, a
 * container, the pause menu). Retry for a few seconds before giving up.
 */
async function forceShow(form, player, attempts = 20) {
  for (let i = 0; i < attempts; i++) {
    const response = await form.show(player);
    if (response.cancelationReason !== FormCancelationReason.UserBusy) {
      return response;
    }
    await delay(5);
  }
  return undefined;
}

/* ------------------------------------------------------------------ *
 * Result screen
 * ------------------------------------------------------------------ */

async function showResult(player, statusLine, detailLines) {
  const form = new ActionFormData()
    .title(FORM_TITLE_RESULT)
    .body([statusLine, "", ...detailLines].join("\n"))
    .button("Close");

  try {
    await form.show(player);
  } catch {
    /* player disconnected before the readout came up */
  }
}

/* ------------------------------------------------------------------ *
 * Main screen
 * ------------------------------------------------------------------ */

/**
 * @param {import("@minecraft/server").Player} player
 * @param {{x:number,y:number,z:number}} tableLocation
 */
export async function openSchemTable(player, tableLocation) {
  if (openScreens.has(player.id)) return;
  openScreens.add(player.id);

  try {
    const held = getMainHand(player);
    if (!isChargedWand(held)) {
      actionBar(player, "§cPlace a charged Schem Wand first.");
      return;
    }

    const sel = readSelection(held);
    const suggested = defaultName(sel);

    const form = new ModalFormData()
      .title(FORM_TITLE_INPUT)
      .textField("§7Structure name", "Enter structure name...", suggested)
      .submitButton("Confirm");

    const response = await forceShow(form, player);

    if (!response || response.canceled) {
      // Closing the screen cancels the operation and leaves the wand charged.
      return;
    }

    await handleConfirm(player, tableLocation, response.formValues?.[0]);
  } catch (err) {
    console.warn(`[Bedromatica] Schem Table screen failed: ${err?.message ?? err}`);
  } finally {
    openScreens.delete(player.id);
  }
}

function defaultName(sel) {
  if (!sel.pos1 || !sel.pos2) return "";
  const { size } = normalizeRegion(sel.pos1, sel.pos2);
  return `schem_${size.x}x${size.y}x${size.z}`;
}

/* ------------------------------------------------------------------ *
 * Confirm
 * ------------------------------------------------------------------ */

/**
 * Saves the wand's snapshot under the typed name. Whatever happens the wand
 * ends up blank and unglinted, so a failed save never leaves the player
 * holding a wand that looks charged but is not.
 *
 * @param {import("@minecraft/server").Player} player
 * @param {{x:number,y:number,z:number}|undefined} tableLocation
 * @param {unknown} typedName
 */
export async function handleConfirm(player, tableLocation, typedName) {
  const held = getMainHand(player);

  if (!isChargedWand(held)) {
    // The wand was swapped away while the screen was open.
    await showResult(player, "§cUnsuccessful", ["§7The charged wand left your hand."]);
    return;
  }

  // The table may have been mined while the screen was open. That is a quiet
  // cancel, not a failure - the wand keeps its data.
  if (tableLocation && !tableStillThere(player, tableLocation)) {
    actionBar(player, "§7Schem Table was removed; save cancelled.");
    return;
  }

  const sel = readSelection(held);

  if (!sel.pos1 || !sel.pos2) {
    await failSave(player, held, sel, "The wand's stored corners are missing.");
    return;
  }

  const parsed = sanitizeName(typedName);

  if (!parsed.ok) {
    await failSave(player, held, sel, parsed.error);
    return;
  }

  let dimension = player.dimension;
  if (sel.dimensionId && sel.dimensionId !== dimension.id) {
    try {
      dimension = world.getDimension(sel.dimensionId);
    } catch {
      dimension = player.dimension;
    }
  }

  const result = finalizeCapture(player, dimension, sel, parsed.name);

  if (!result.ok) {
    await failSave(player, held, sel, result.error);
    return;
  }

  // Success: drop the snapshot, blank the wand, clear every stored property.
  discardStructure(sel.structureId);
  setMainHand(player, makeBlankWand(held));
  clearPlayerMirror(player);
  forgetPlayer(player.id);

  const { size } = normalizeRegion(sel.pos1, sel.pos2);
  const filePath = structureFilePath(parsed.name);
  const detail = [
    `§7Saved as §f${result.finalId}`,
    `§7Size §f${size.x} x ${size.y} x ${size.z}`,
    `§7Region §f${formatVec(sel.pos1)} §7to §f${formatVec(sel.pos2)}`,
    "",
    "§7File §f" + filePath,
    "§8inside your world folder. Copy it into the pack's own",
    `§8${STRUCTURE_FOLDER} folder to ship it with Bedromatica.`
  ];

  actionBar(player, `§aSuccessful §7- ${result.finalId}`);

  // Also put the path in chat so it survives the screen closing.
  try {
    player.sendMessage(
      `§7[§bBedromatica§7] §aSaved §f${result.finalId}\n§7  file: §f${filePath}`
    );
  } catch {
    /* player disconnected */
  }

  await showResult(player, "§aSuccessful", detail);
}

/** Failure path: same cleanup as success, minus the saved structure. */
async function failSave(player, held, sel, reason) {
  discardStructure(sel.structureId);
  setMainHand(player, makeBlankWand(held));
  clearPlayerMirror(player);
  forgetPlayer(player.id);

  actionBar(player, `§cUnsuccessful §7- ${reason}`);
  await showResult(player, "§cUnsuccessful", [
    `§7${reason}`,
    "",
    "§8The wand has been emptied. Make a new selection to try again."
  ]);
}

function tableStillThere(player, location) {
  try {
    return player.dimension.getBlock(location)?.typeId === BLOCK_TABLE;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Script events
 * ------------------------------------------------------------------ */

/**
 * `scriptevent bedromatica:confirm_save <name>` saves the held selection
 * without going through the screen.
 * `scriptevent bedromatica:status` prints the wand's stored state.
 * `scriptevent bedromatica:reset` empties the held wand.
 */
export function registerScriptEvents() {
  system.afterEvents.scriptEventReceive.subscribe(
    (event) => {
      const player = event.sourceEntity;
      if (!player || player.typeId !== "minecraft:player") return;

      switch (event.id) {
        case "bedromatica:confirm_save":
          handleConfirm(player, undefined, event.message);
          break;

        case "bedromatica:reset": {
          const held = getMainHand(player);
          if (held) resetWand(player, held);
          break;
        }

        case "bedromatica:status": {
          const { sel, hasData } = readPlayerMirror(player);
          player.sendMessage([
            "§7--- §bBedromatica§7 ---",
            `§7charged: §f${hasData}`,
            `§7pos1: §f${sel.pos1 ? formatVec(sel.pos1) : "unset"}`,
            `§7pos2: §f${sel.pos2 ? formatVec(sel.pos2) : "unset"}`,
            `§7snapshot: §f${sel.structureId ?? "none"}`,
            `§7name limit: §f${MAX_NAME_LENGTH} characters`
          ].join("\n"));
          break;
        }

        default:
          break;
      }
    },
    { namespaces: ["bedromatica"] }
  );
}
