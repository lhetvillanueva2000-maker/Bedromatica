/**
 * Reads a structure's name and works out what it probably is.
 *
 * The point is not cleverness for its own sake - it is that the right filter
 * depends entirely on what the build IS. Strip water from a guardian farm and
 * you have destroyed it. Strip leaves from a tree farm and you have deleted the
 * harvest. Strip nothing from a hillside base and you have exported half a
 * mountain. A name like "iron_farm_v3" already tells you which of those you are
 * holding, so the app reads it and sets the filter accordingly.
 *
 * Matching is plain keyword scoring, not a model: it runs offline, in a
 * millisecond, and every decision it makes can be traced to a word in the name.
 */

/**
 * What each build type needs left alone.
 *
 *  redstone  - keep fluids and every solid; only loose ground goes. Water and
 *              lava are working parts of most farms, and one missing block
 *              breaks a circuit.
 *  organic   - keep plants; they are the crop. Ground still goes.
 *  build     - the ordinary case: ground, plants and fluids are scenery.
 *  excavated - the build is cut into terrain, so rock goes too.
 */
export const PRESET = {
  REDSTONE: "redstone",
  ORGANIC: "organic",
  BUILD: "build",
  EXCAVATED: "excavated"
};

export const PRESET_LABEL = {
  [PRESET.REDSTONE]: "Keep every solid and fluid",
  [PRESET.ORGANIC]: "Keep the plants",
  [PRESET.BUILD]: "Cut ground, plants and water",
  [PRESET.EXCAVATED]: "Cut ground and rock"
};

/**
 * Knowledge base. `words` are matched against the name with word boundaries
 * where sensible; longer, more specific entries score higher so "iron golem
 * farm" beats a bare "farm".
 */
const KNOWLEDGE = [
  /* ---- mob farms: redstone, water-driven, nothing may be stripped ---- */
  { type: "iron farm", preset: PRESET.REDSTONE, words: ["iron farm", "iron golem", "irongolem", "golem farm"],
    advice: "Villager-driven. Water streams and the zombie cell are working parts." },
  { type: "gold farm", preset: PRESET.REDSTONE, words: ["gold farm", "piglin farm", "zombified piglin", "pigman farm"],
    advice: "Nether portal geometry matters block for block." },
  { type: "creeper farm", preset: PRESET.REDSTONE, words: ["creeper farm", "gunpowder farm", "charged creeper"],
    advice: "Spawn platform spacing and the roof are load-bearing for rates." },
  { type: "enderman farm", preset: PRESET.REDSTONE, words: ["enderman farm", "ender farm", "endermen", "ender ender", "xp farm"],
    advice: "End-void platform. Keep every block of the collection funnel." },
  { type: "guardian farm", preset: PRESET.REDSTONE, words: ["guardian farm", "guardian", "monument farm"],
    advice: "Water is the mechanism here - do not strip fluids." },
  { type: "raid farm", preset: PRESET.REDSTONE, words: ["raid farm", "raid", "pillager farm", "outpost farm"],
    advice: "Spawn platform and the villager cell must stay exact." },
  { type: "mob grinder", preset: PRESET.REDSTONE, words: ["mob farm", "mob grinder", "mob spawner", "spawner farm", "grinder", "dark room"],
    advice: "Spawn surfaces and the drop height are the design." },
  { type: "wither skeleton farm", preset: PRESET.REDSTONE, words: ["wither skeleton", "wither skull", "fortress farm"],
    advice: "Nether fortress spawn volume. Keep the netherrack shell." },
  { type: "blaze farm", preset: PRESET.REDSTONE, words: ["blaze farm", "blaze rod", "blaze spawner"],
    advice: "Built around a spawner - keep everything near it." },
  { type: "slime farm", preset: PRESET.REDSTONE, words: ["slime farm", "slime chunk", "slimeball"],
    advice: "Chunk-aligned. Cropping is fine, but keep the full platform." },
  { type: "witch farm", preset: PRESET.REDSTONE, words: ["witch farm", "witch hut", "redstone dust farm"],
    advice: "Hut-based spawn volume; the surrounding water counts." },
  { type: "shulker farm", preset: PRESET.REDSTONE, words: ["shulker farm", "shulker"],
    advice: "End city mechanics. Keep the purpur exactly as built." },
  { type: "drowned farm", preset: PRESET.REDSTONE, words: ["drowned farm", "copper farm", "trident farm"],
    advice: "Water volume is the spawn condition." },
  { type: "spawner XP farm", preset: PRESET.REDSTONE, words: ["xp grinder", "experience farm", "exp farm"],
    advice: "Keep the spawner and its immediate cell." },

  /* ---- villager infrastructure ---- */
  { type: "villager breeder", preset: PRESET.REDSTONE, words: ["villager breeder", "breeder", "villager farm"],
    advice: "Beds, workstations and the transport water all matter." },
  { type: "trading hall", preset: PRESET.BUILD, words: ["trading hall", "trading", "villager hall", "librarian"],
    advice: "Mostly a building. Workstations must survive the filter." },

  /* ---- crop and plant farms: the plants ARE the build ---- */
  { type: "tree farm", preset: PRESET.ORGANIC, words: ["tree farm", "wood farm", "log farm", "sapling farm", "bamboo farm"],
    advice: "Leaves and logs kept - they are the crop, not scenery." },
  { type: "crop farm", preset: PRESET.ORGANIC, words: ["wheat farm", "carrot farm", "potato farm", "beetroot farm", "crop farm", "food farm"],
    advice: "Farmland and crops kept; only surrounding ground goes." },
  { type: "sugar cane farm", preset: PRESET.ORGANIC, words: ["sugar cane", "sugarcane", "cane farm", "paper farm"],
    advice: "Cane and its water source are the mechanism." },
  { type: "melon / pumpkin farm", preset: PRESET.ORGANIC, words: ["melon farm", "pumpkin farm", "melon", "pumpkin"],
    advice: "Stems and the growing surface kept." },
  { type: "kelp farm", preset: PRESET.ORGANIC, words: ["kelp farm", "kelp", "seagrass"],
    advice: "Underwater build - fluids kept." },
  { type: "cactus farm", preset: PRESET.ORGANIC, words: ["cactus farm", "cactus", "green dye farm"],
    advice: "Sand pillars are part of the design, not terrain." },
  { type: "mushroom farm", preset: PRESET.ORGANIC, words: ["mushroom farm", "mushroom", "fungus farm", "nylium"],
    advice: "Mycelium and nylium kept as the growing surface." },
  { type: "bee farm", preset: PRESET.ORGANIC, words: ["bee farm", "honey farm", "beehive", "apiary"],
    advice: "Flowers and hives kept." },
  { type: "moss farm", preset: PRESET.ORGANIC, words: ["moss farm", "bone meal farm", "bonemeal", "composter farm"],
    advice: "Moss and its spread surface kept." },

  /* ---- animal farms ---- */
  { type: "animal farm", preset: PRESET.BUILD, words: ["chicken farm", "chicken cooker", "cow farm", "sheep farm", "pig farm", "animal farm", "wool farm", "leather farm"],
    advice: "Pens and hoppers kept; the field around them goes." },
  { type: "fish farm", preset: PRESET.REDSTONE, words: ["fish farm", "fishing farm", "afk fish"],
    advice: "Water body is the mechanism." },

  /* ---- pure redstone machinery ---- */
  { type: "item sorter", preset: PRESET.REDSTONE, words: ["item sorter", "sorting system", "sorter", "storage system", "storage hall", "auto storage"],
    advice: "Hopper chains and comparator timings - keep every block." },
  { type: "smelter", preset: PRESET.REDSTONE, words: ["super smelter", "auto smelter", "smelter", "furnace array"],
    advice: "Hopper feed order matters. Nothing should be stripped." },
  { type: "piston door", preset: PRESET.REDSTONE, words: ["piston door", "hidden door", "secret door", "vault door", "jeb door", "redstone door"],
    advice: "Pistons, observers and slabs are all timing-critical." },
  { type: "flying machine", preset: PRESET.REDSTONE, words: ["flying machine", "slime machine", "honey machine", "bedrock breaker", "tnt duper"],
    advice: "Slime and honey block layout is the machine." },
  { type: "elevator", preset: PRESET.REDSTONE, words: ["elevator", "lift", "bubble column", "soul sand elevator"],
    advice: "Water column and soul sand kept." },
  { type: "clock / circuit", preset: PRESET.REDSTONE, words: ["clock", "circuit", "logic gate", "redstone", "calculator", "computer", "memory", "cpu", "alu", "adder"],
    advice: "A circuit. Every block is signal path - filter nothing." },
  { type: "cobblestone generator", preset: PRESET.REDSTONE, words: ["cobblestone generator", "cobble gen", "stone generator", "stone gen", "basalt gen", "obsidian farm"],
    advice: "Lava and water placement is the generator." },
  { type: "auto farm", preset: PRESET.REDSTONE, words: ["auto farm", "automatic farm", "afk farm", "villager crop"],
    advice: "Dispensers, pistons and water all working parts." },

  /* ---- buildings ---- */
  { type: "base", preset: PRESET.EXCAVATED, words: ["base", "bunker", "hideout", "underground", "cave base", "mine base"],
    advice: "Often dug into terrain, so rock is pre-cut too." },
  { type: "house", preset: PRESET.BUILD, words: ["house", "home", "cottage", "cabin", "hut", "shack", "villa"],
    advice: "A building sitting on ground - the usual filter." },
  { type: "castle / tower", preset: PRESET.BUILD, words: ["castle", "tower", "keep", "fort", "citadel", "spire", "wall"],
    advice: "A building sitting on ground - the usual filter." },
  { type: "bridge", preset: PRESET.BUILD, words: ["bridge", "viaduct", "aqueduct", "causeway"],
    advice: "Free-standing; almost nothing around it should survive." },
  { type: "statue", preset: PRESET.BUILD, words: ["statue", "sculpture", "pixel art", "pixelart", "mural", "monument"],
    advice: "Its blocks are the artwork - only the ground goes." },
  { type: "shop / market", preset: PRESET.BUILD, words: ["shop", "market", "stall", "store", "mall"],
    advice: "A building - the usual filter." },
  { type: "spawn area", preset: PRESET.BUILD, words: ["spawn", "hub", "lobby", "portal room", "nether hub"],
    advice: "A building - the usual filter." },
  { type: "farm plot", preset: PRESET.ORGANIC, words: ["garden", "greenhouse", "orchard", "plantation"],
    advice: "Plants kept as part of the build." }
];

/** Generic words that should not, alone, drive a decision. */
const WEAK = new Set(["farm", "build", "test", "new", "old", "copy", "final", "v1", "v2", "v3"]);

function normalise(name) {
  return name
    .toLowerCase()
    .replace(/[_\-.]+/g, " ")
    .replace(/\d+x\d+(x\d+)?/g, " ")
    .replace(/\bv\d+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {string} rawName
 * @returns {{type: string, preset: string, advice: string, confidence: number, matched: string}|null}
 */
export function identify(rawName) {
  const name = normalise(rawName ?? "");
  if (!name) return null;

  let best = null;

  for (const entry of KNOWLEDGE) {
    for (const word of entry.words) {
      if (!name.includes(word)) continue;
      // Longer matches are more specific, so they win. "iron golem farm"
      // should not lose to a bare "farm" appearing later in the list.
      const score = word.length + (WEAK.has(word) ? -20 : 0);
      if (!best || score > best.score) {
        best = { entry, word, score };
      }
    }
  }

  if (!best) return null;

  // A single short keyword in a long name is a weaker signal than a phrase.
  const coverage = best.word.length / Math.max(name.length, 1);
  const confidence = Math.min(0.98, 0.55 + coverage * 0.5 + (best.word.includes(" ") ? 0.15 : 0));

  return {
    type: best.entry.type,
    preset: best.entry.preset,
    advice: best.entry.advice,
    matched: best.word,
    confidence
  };
}

/**
 * Turns a preset into the set of palette indices to strip.
 * @param {import("./mcstructure.js").McStructure} structure
 */
export function removalsFor(structure, preset) {
  switch (preset) {
    case PRESET.REDSTONE:
      // Ground only. Fluids and plants can be wiring or spawn conditions.
      return structure.defaultRemovals(false, { fluids: false, plants: false });
    case PRESET.ORGANIC:
      // Ground and standing water, but the plants are the point.
      return structure.defaultRemovals(false, { plants: false });
    case PRESET.EXCAVATED:
      return structure.defaultRemovals(true);
    case PRESET.BUILD:
    default:
      return structure.defaultRemovals(false);
  }
}

export const KNOWLEDGE_SIZE = KNOWLEDGE.length;
export const KEYWORD_COUNT = KNOWLEDGE.reduce((n, e) => n + e.words.length, 0);
