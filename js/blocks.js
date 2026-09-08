/**
 * Block classification and colour.
 *
 * Two jobs: decide what a block *is* (so terrain can be pre-selected for
 * removal without touching the build), and give it a colour for the 3D view.
 *
 * Classification is deliberately conservative. Cobblestone, logs and planks
 * are building materials as often as they are scenery, so they are never
 * pre-marked as clutter - only unambiguous ground, plants and fluids are. The
 * palette list in the app is the real control; this just sets the checkboxes
 * you start with.
 */

export const CATEGORY = {
  AIR: "air",
  TERRAIN: "terrain",
  PLANT: "plant",
  FLUID: "fluid",
  BUILD: "build"
};

/**
 * Soft ground: the loose stuff a build sits on. Cutting these by default is
 * safe because almost nobody builds walls out of dirt or gravel.
 */
const GROUND = new Set([
  "grass_block", "grass", "dirt", "coarse_dirt", "rooted_dirt", "dirt_with_roots",
  "podzol", "mycelium", "grass_path", "dirt_path", "farmland", "mud",
  "muddy_mangrove_roots", "clay", "sand", "red_sand", "suspicious_sand",
  "suspicious_gravel", "gravel", "soul_sand", "soul_soil", "snow", "snow_layer",
  "moss_block", "crimson_nylium", "warped_nylium", "sculk", "sculk_vein"
]);

/**
 * Rock. Displayed as terrain so it is easy to find, but NOT cut by default -
 * stone, deepslate and the rest are building materials at least as often as
 * they are scenery, and silently deleting someone's walls is far worse than
 * leaving a hillside they can remove with one tap.
 */
const ROCK = new Set([
  "stone", "granite", "diorite", "andesite", "deepslate", "cobbled_deepslate",
  "tuff", "calcite", "dripstone_block", "pointed_dripstone", "bedrock",
  "netherrack", "end_stone", "blackstone", "basalt", "smooth_basalt", "magma",
  "ice", "packed_ice", "blue_ice", "frosted_ice", "sandstone", "red_sandstone",
  "terracotta", "hardened_clay", "monster_egg", "infested_stone"
]);

/** Plants, foliage and other decoration that grows on terrain. */
const PLANTS = new Set([
  "short_grass", "tall_grass", "fern", "large_fern", "double_plant", "tallgrass",
  "seagrass", "kelp", "kelp_plant", "vine", "cave_vines", "cave_vines_body_with_berries",
  "cave_vines_head_with_berries", "twisting_vines", "weeping_vines", "hanging_roots",
  "dead_bush", "dandelion", "poppy", "blue_orchid", "allium", "azure_bluet",
  "oxeye_daisy", "cornflower", "lily_of_the_valley", "wither_rose", "torchflower",
  "pink_petals", "sunflower", "lilac", "rose_bush", "peony", "red_flower",
  "yellow_flower", "sugar_cane", "reeds", "cactus", "bamboo", "bamboo_sapling",
  "moss_carpet", "azalea", "flowering_azalea", "big_dripleaf", "small_dripleaf",
  "spore_blossom", "glow_lichen", "lily_pad", "waterlily", "sweet_berry_bush",
  "brown_mushroom", "red_mushroom", "crimson_roots", "warped_roots", "nether_sprouts",
  "fire", "soul_fire", "cobweb", "web", "turtle_egg", "frogspawn", "wheat",
  "carrots", "potatoes", "beetroot", "melon_stem", "pumpkin_stem", "torchflower_crop"
]);

const FLUIDS = new Set([
  "water", "flowing_water", "lava", "flowing_lava", "bubble_column"
]);

/** Suffixes that reliably mark a whole family. */
const TERRAIN_SUFFIXES = ["_ore", "_stone", "_deepslate"];
const PLANT_SUFFIXES = ["_leaves", "_sapling", "_tulip", "_coral", "_coral_fan", "_coral_block"];

/** Strips the namespace so "minecraft:grass_block" matches "grass_block". */
export function shortName(name) {
  const i = name.indexOf(":");
  return i === -1 ? name : name.slice(i + 1);
}

export function classify(name) {
  const s = shortName(name);
  if (s === "air" || s === "structure_void") return CATEGORY.AIR;
  if (FLUIDS.has(s)) return CATEGORY.FLUID;
  if (GROUND.has(s) || ROCK.has(s)) return CATEGORY.TERRAIN;
  if (PLANTS.has(s)) return CATEGORY.PLANT;
  for (const suffix of PLANT_SUFFIXES) if (s.endsWith(suffix)) return CATEGORY.PLANT;
  for (const suffix of TERRAIN_SUFFIXES) if (s.endsWith(suffix)) return CATEGORY.TERRAIN;
  return CATEGORY.BUILD;
}

/**
 * What gets ticked for removal the moment a structure loads: loose ground,
 * plants and fluids. Rock is deliberately excluded - see ROCK above.
 */
export function isDefaultCut(name) {
  const s = shortName(name);
  if (GROUND.has(s) || FLUIDS.has(s) || PLANTS.has(s)) return true;
  for (const suffix of PLANT_SUFFIXES) if (s.endsWith(suffix)) return true;
  return s.endsWith("_ore");
}

/** The heavier sweep behind the "Cut rock too" button. */
export function isTerrainOfAnyKind(name) {
  if (isDefaultCut(name)) return true;
  const s = shortName(name);
  if (ROCK.has(s)) return true;
  for (const suffix of TERRAIN_SUFFIXES) if (s.endsWith(suffix)) return true;
  return false;
}

/* ------------------------------------------------------------------ *
 * Colour
 * ------------------------------------------------------------------ */

/** Hand-picked colours for the blocks that show up most. */
const COLORS = {
  air: 0x25384f, structure_void: 0x25384f,
  grass_block: 0x6a9b3f, grass: 0x6a9b3f, short_grass: 0x6a9b3f, tall_grass: 0x6a9b3f,
  dirt: 0x8b5a33, coarse_dirt: 0x7d5130, rooted_dirt: 0x90603c, podzol: 0x5c3c18,
  dirt_path: 0x9c7f4e, farmland: 0x6b4426, mud: 0x40352d,
  sand: 0xdbd3a0, red_sand: 0xbe6620, gravel: 0x8a8686, clay: 0xa0a7b4,
  stone: 0x8f8f8f, cobblestone: 0x7a7a7a, mossy_cobblestone: 0x6c7a5c,
  granite: 0x9c6a5a, diorite: 0xc4c4c0, andesite: 0x8e8e8d,
  deepslate: 0x4f4f55, cobbled_deepslate: 0x525257, tuff: 0x6b6d63,
  calcite: 0xdfdedb, dripstone_block: 0x8a6a58, bedrock: 0x565656,
  netherrack: 0x6f3634, soul_sand: 0x51403a, soul_soil: 0x4b3a33,
  blackstone: 0x2b2426, basalt: 0x4f4f55, end_stone: 0xdcdca4,
  sandstone: 0xd9d0a4, red_sandstone: 0xba6a29, terracotta: 0x975d43,

  water: 0x3a6fd8, flowing_water: 0x3a6fd8, lava: 0xe25822, flowing_lava: 0xe25822,
  ice: 0x93b8f0, packed_ice: 0x8db4ee, blue_ice: 0x74a8f5, snow: 0xf2fafa, snow_layer: 0xf2fafa,

  oak_log: 0x6b5231, spruce_log: 0x4a3418, birch_log: 0xc8b478, jungle_log: 0x6d5334,
  acacia_log: 0xa85b32, dark_oak_log: 0x3c2a15, mangrove_log: 0x763a30, cherry_log: 0xd4a0a4,
  oak_planks: 0xa0814c, spruce_planks: 0x715030, birch_planks: 0xc8b37d,
  jungle_planks: 0xa87c56, acacia_planks: 0xba6337, dark_oak_planks: 0x4a3018,
  mangrove_planks: 0x8b4a3d, cherry_planks: 0xe0b0ac, bamboo_planks: 0xc4a45c,

  oak_leaves: 0x4e8a30, spruce_leaves: 0x3c6136, birch_leaves: 0x77a33e,
  jungle_leaves: 0x40a123, acacia_leaves: 0x77a63c, dark_oak_leaves: 0x3f7526,

  glass: 0xc8e5e8, white_stained_glass: 0xe8e8e8, glass_pane: 0xc8e5e8,
  redstone_block: 0xc41d10, redstone_wire: 0xa01008, redstone_torch: 0xd42a1a,
  redstone_lamp: 0x9c6a3c, repeater: 0xbfb0aa, comparator: 0xbfb0aa,
  observer: 0x5f5f63, piston: 0x9c8654, sticky_piston: 0x81964f,
  hopper: 0x3b3b40, dropper: 0x757575, dispenser: 0x757575,
  chest: 0x8f6c30, trapped_chest: 0x8f6c30, barrel: 0x84683a,
  furnace: 0x767676, note_block: 0x6b4a2c, target: 0xd6cdc4,
  slime: 0x77c855, honey_block: 0xf8b530, tnt: 0xc42d1e, lever: 0x8c8c8c,
  rail: 0x9b8a63, powered_rail: 0xc0964a, detector_rail: 0xa07f56,

  iron_block: 0xdcdcdc, gold_block: 0xf5c342, diamond_block: 0x50e0d4,
  emerald_block: 0x2fc25f, netherite_block: 0x453f42, copper_block: 0xc26a4c,
  quartz_block: 0xe8e3da, obsidian: 0x14101f, glowstone: 0xf3d38b,
  sea_lantern: 0xd6e6dc, shroomlight: 0xf39a4b, torch: 0xf0c14b,

  white_wool: 0xe9ecec, black_wool: 0x1d1c21, red_wool: 0xb02e26, blue_wool: 0x3c44aa,
  green_wool: 0x5e7c16, yellow_wool: 0xf1b31c, orange_wool: 0xf9801d,
  brick_block: 0x986152, bricks: 0x986152, stone_bricks: 0x7b7b75, nether_brick: 0x2d161a
};

/**
 * Stable pseudo-colour for anything not in the table, so unknown blocks still
 * read as distinct shapes instead of a field of identical grey.
 */
function hashColor(name) {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hue = (h >>> 0) % 360;
  return hslToRgb(hue / 360, 0.32, 0.55);
}

function hslToRgb(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  return (Math.round(f(0) * 255) << 16) | (Math.round(f(8) * 255) << 8) | Math.round(f(4) * 255);
}

export function blockColor(name) {
  const s = shortName(name);
  if (COLORS[s] !== undefined) return COLORS[s];

  // Family fallbacks before giving up to the hash.
  if (s.endsWith("_leaves")) return 0x4e8a30;
  if (s.endsWith("_log") || s.endsWith("_wood") || s.endsWith("_stem")) return 0x6b5231;
  if (s.endsWith("_planks")) return 0xa0814c;
  if (s.endsWith("_wool")) return 0xbdbdbd;
  if (s.endsWith("_concrete")) return 0x9a9a9a;
  if (s.endsWith("_terracotta")) return 0x975d43;
  if (s.endsWith("_stained_glass") || s.endsWith("_glass_pane")) return 0xc8e5e8;
  if (s.endsWith("_ore")) return 0x8a8a8a;
  if (s.includes("deepslate")) return 0x4f4f55;
  if (s.includes("copper")) return 0xc26a4c;
  return hashColor(s);
}

/** Blocks that do not fill their cell, so the viewer can draw them smaller. */
const THIN = new Set([
  "redstone_wire", "rail", "powered_rail", "detector_rail", "activator_rail",
  "torch", "redstone_torch", "soul_torch", "lever", "tripwire", "snow_layer",
  "carpet", "pressure_plate", "vine", "glow_lichen", "ladder", "string"
]);

export function isThin(name) {
  const s = shortName(name);
  if (THIN.has(s)) return true;
  return s.endsWith("_carpet") || s.endsWith("_pressure_plate") || s.endsWith("_rail");
}
