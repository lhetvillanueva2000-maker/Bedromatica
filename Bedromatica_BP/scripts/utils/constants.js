/**
 * Bedromatica - shared identifiers, limits and tunables.
 *
 * Everything that appears in more than one module lives here so that a rename
 * never has to be chased across files.
 */

export const NAMESPACE = "bedromatica";

/* ------------------------------------------------------------------ *
 * Content identifiers
 * ------------------------------------------------------------------ */

/** The wand in its empty state (no glint). */
export const ITEM_WAND = "bedromatica:schem_wand";

/**
 * The wand in its charged state. Bedrock item components are static JSON and
 * `minecraft:glint` cannot be flipped on a live ItemStack, so "toggling glint"
 * is implemented by swapping the held stack between these two item definitions.
 * Both share one geometry, one texture and one animation set, so the swap is
 * invisible apart from the enchant shimmer.
 */
export const ITEM_WAND_CHARGED = "bedromatica:schem_wand_charged";

export const BLOCK_TABLE = "bedromatica:schem_table";
export const PARTICLE_SELECTION = "bedromatica:selection_line";

/* ------------------------------------------------------------------ *
 * Dynamic property keys
 * ------------------------------------------------------------------ */

export const PROP_POS1 = "bedromatica:pos1";
export const PROP_POS2 = "bedromatica:pos2";
export const PROP_HAS_DATA = "bedromatica:has_data";
export const PROP_STRUCTURE_ID = "bedromatica:structure_id";
export const PROP_DIMENSION = "bedromatica:dimension";

/* ------------------------------------------------------------------ *
 * UI
 * ------------------------------------------------------------------ */

/**
 * Sentinel titles. `ui/bedromatica_server_form.json` compares `#title_text`
 * against these exact strings to decide whether to draw the Schem Table
 * artwork, so they must stay byte-identical on both sides.
 */
export const FORM_TITLE_INPUT = "Bedromatica Schem Table";
export const FORM_TITLE_RESULT = "Bedromatica Diagnostics";

export const MAX_NAME_LENGTH = 30;

/* ------------------------------------------------------------------ *
 * Structure limits
 * ------------------------------------------------------------------ */

/** Hard engine limit on a single saved structure (same as a structure block). */
export const MAX_STRUCTURE_X = 64;
export const MAX_STRUCTURE_Y = 384;
export const MAX_STRUCTURE_Z = 64;

/** Namespace the finished capture is filed under, matching `/structure save`. */
export const STRUCTURE_NAMESPACE = "mystructure";

/** Namespace used for the throwaway snapshot the wand carries around. */
export const TEMP_STRUCTURE_NAMESPACE = "bedromatica";

/**
 * The pack's own structure folder, shown to the player after a save. Bedrock
 * packs are read-only at runtime, so the engine writes the .mcstructure into
 * the world folder; copying it here bundles it with the addon.
 */
export const STRUCTURE_FOLDER = "Bedromatica_BP/structures/mystructure";

/* ------------------------------------------------------------------ *
 * Selection rendering
 * ------------------------------------------------------------------ */

/** Tick period for the live pos1 -> crosshair preview box. */
export const PREVIEW_REFRESH_TICKS = 2;

/** Tick period for the locked pos1 <-> pos2 box. */
export const LOCKED_REFRESH_TICKS = 5;

/** Preferred spacing between outline dots, in blocks. */
export const DOT_SPACING = 0.5;

/**
 * Upper bound on dots emitted for one box in one refresh. Spacing is widened
 * automatically when a selection is large enough to exceed this, which keeps a
 * 64x384x64 region from flooding the particle system.
 */
export const MAX_DOTS_PER_BOX = 640;

/** How far the crosshair reaches when previewing pos2. */
export const RAYCAST_DISTANCE = 8;
