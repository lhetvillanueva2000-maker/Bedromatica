/**
 * Entities inside a .mcstructure.
 *
 * The structure's `entities` list holds full NBT for anything that was standing
 * in the captured region. We only want the things that are part of a build -
 * item frames on a wall, an armour stand holding a kit, paintings, the minecart
 * sitting in a station - and never the cow that wandered through.
 *
 * That filter is an allowlist, not a mob blocklist, and deliberately so. A
 * blocklist has to know every mob in every version plus whatever a mod added;
 * miss one and a zombie ends up in the export. An allowlist can only ever fail
 * closed: an unrecognised entity is skipped, which is the safe direction.
 */

/** Decorative and utility entities worth drawing and keeping. */
const KEEP = new Set([
  // Wall and display
  "item_frame", "glow_item_frame", "painting", "armor_stand",
  // Rails
  "minecart", "chest_minecart", "hopper_minecart", "tnt_minecart",
  "command_block_minecart", "furnace_minecart",
  // Water
  "boat", "chest_boat",
  // Structural odds and ends
  "end_crystal", "leash_knot", "glow_squid_spawn_egg_placeholder",
  "falling_block", "block_display", "item_display", "text_display", "interaction"
]);

/** Shown in the viewer with a distinct silhouette. */
export const ENTITY_SHAPE = {
  item_frame: "panel",
  glow_item_frame: "panel",
  painting: "panel",
  armor_stand: "post",
  block_display: "cube",
  item_display: "cube",
  text_display: "panel",
  end_crystal: "cube",
  minecart: "cart",
  chest_minecart: "cart",
  hopper_minecart: "cart",
  tnt_minecart: "cart",
  command_block_minecart: "cart",
  furnace_minecart: "cart",
  boat: "cart",
  chest_boat: "cart"
};

export const ENTITY_COLOR = {
  item_frame: 0xb08a5a,
  glow_item_frame: 0xe0c070,
  painting: 0x9c6a3c,
  armor_stand: 0xd8d2c4,
  end_crystal: 0xe08cf0,
  block_display: 0x8fb8d8,
  item_display: 0x8fb8d8,
  text_display: 0x8fb8d8,
  interaction: 0x6ce0ec
};

const DEFAULT_COLOR = 0x9aa8bb;

function shortName(id) {
  const i = id.indexOf(":");
  return i === -1 ? id : id.slice(i + 1);
}

/**
 * Reads the entity list out of a parsed structure.
 *
 * Positions are absolute world coordinates in the file, so they are rebased
 * onto the structure's own origin to become local cell coordinates.
 *
 * @param {import("./mcstructure.js").McStructure} structure
 * @returns {{kept: Array, skipped: number, skippedKinds: string[]}}
 */
export function readEntities(structure) {
  const list = structure.entities?.v?.items ?? [];
  const kept = [];
  const skippedKinds = new Set();
  let skipped = 0;

  for (const entry of list) {
    if (!entry?.v?.get) continue;

    const identifier =
      entry.v.get("identifier")?.v ?? entry.v.get("id")?.v ?? "";
    if (!identifier) {
      skipped++;
      continue;
    }

    const name = shortName(identifier);
    if (!KEEP.has(name)) {
      skipped++;
      skippedKinds.add(name);
      continue;
    }

    const pos = entry.v.get("Pos")?.v?.items?.map((i) => i.v);
    if (!pos || pos.length < 3) {
      skipped++;
      continue;
    }

    const rotation = entry.v.get("Rotation")?.v?.items?.map((i) => i.v) ?? [0, 0];

    kept.push({
      identifier,
      name,
      shape: ENTITY_SHAPE[name] ?? "cube",
      color: ENTITY_COLOR[name] ?? DEFAULT_COLOR,
      // Local to the structure, matching how block cells are addressed.
      x: pos[0] - structure.origin[0],
      y: pos[1] - structure.origin[1],
      z: pos[2] - structure.origin[2],
      yaw: rotation[0] ?? 0,
      tag: entry
    });
  }

  return { kept, skipped, skippedKinds: [...skippedKinds] };
}

/** Counts by kind, for the entity readout in the UI. */
export function summarise(entities) {
  const counts = new Map();
  for (const e of entities) counts.set(e.name, (counts.get(e.name) ?? 0) + 1);
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * The NBT entries to write back out. Mobs are dropped even when the user asks
 * to keep entities, which is the whole point of the allowlist.
 */
export function keepableTags(entities) {
  return entities.map((e) => e.tag);
}
