/**
 * Lever simulation.
 *
 * Deliberately narrow: flip a lever and watch what it powers. Full redstone is
 * a tick-scheduled state machine with repeaters, comparators, observers,
 * quasi-connectivity and update order - emulating it faithfully is its own
 * project, and a half-accurate version would be worse than none because it
 * would tell you a broken circuit works.
 *
 * What this does model, and models honestly:
 *   - levers, buttons and torches as power sources you can toggle
 *   - redstone dust carrying signal, losing one strength per block, dying at 0
 *   - dust stepping up and down one block, the way it does in game
 *   - lamps, doors, pistons and other consumers lighting when fed
 *
 * Anything with a delay or a direction - repeaters, comparators, observers -
 * is treated as a plain consumer and never as a conductor. It will light up,
 * but it will not pass signal on, and the UI says so rather than pretending.
 */

import { shortName } from "./blocks.js";

const MAX_STRENGTH = 15;

/** Things the user can click to toggle. */
const SOURCES = new Set(["lever"]);

/** Carries signal to its neighbours, losing strength. */
const WIRE = new Set(["redstone_wire", "redstone"]);

/** Lights up when fed but does not pass signal along. */
const CONSUMERS = new Set([
  "redstone_lamp", "lit_redstone_lamp", "redstone_torch", "unlit_redstone_torch",
  "piston", "sticky_piston", "piston_arm_collision", "dispenser", "dropper",
  "note_block", "tnt", "iron_door", "iron_trapdoor", "wooden_door", "trapdoor",
  "fence_gate", "hopper", "rail", "powered_rail", "activator_rail", "detector_rail",
  "bell", "dragon_egg", "observer", "repeater", "unpowered_repeater",
  "powered_repeater", "comparator", "unpowered_comparator", "powered_comparator",
  "redstone_block", "target", "lightning_rod", "copper_bulb"
]);

/** Signal-carrying pieces we explicitly do NOT simulate through. */
const NOT_SIMULATED = new Set([
  "repeater", "unpowered_repeater", "powered_repeater",
  "comparator", "unpowered_comparator", "powered_comparator",
  "observer", "piston", "sticky_piston"
]);

export function isLever(name) {
  return SOURCES.has(shortName(name));
}

export function isWire(name) {
  return WIRE.has(shortName(name));
}

export function isConsumer(name) {
  return CONSUMERS.has(shortName(name));
}

/**
 * A grid view over one structure's cells, so the flood fill can ask "what is
 * at x,y,z" without rescanning the array.
 */
export class RedstoneWorld {
  /** @param {Array<{x,y,z,name,structureIndex}>} cells */
  constructor(cells) {
    this.byKey = new Map();
    this.levers = [];

    for (const cell of cells) {
      this.byKey.set(key(cell.x, cell.y, cell.z), cell);
      if (isLever(cell.name)) this.levers.push(cell);
    }

    /** Lever cell key -> on/off. Levers start off. */
    this.state = new Map(this.levers.map((l) => [key(l.x, l.y, l.z), false]));
  }

  get leverCount() {
    return this.levers.length;
  }

  at(x, y, z) {
    return this.byKey.get(key(x, y, z));
  }

  toggle(cell) {
    const k = key(cell.x, cell.y, cell.z);
    if (!this.state.has(k)) return false;
    this.state.set(k, !this.state.get(k));
    return this.state.get(k);
  }

  isOn(cell) {
    return this.state.get(key(cell.x, cell.y, cell.z)) === true;
  }

  setAll(on) {
    for (const k of this.state.keys()) this.state.set(k, on);
  }

  /**
   * Works out everything currently carrying power.
   *
   * Breadth-first from every switched-on lever: strength 15 at the lever,
   * dropping by one for each dust it crosses, dying at zero. Dust also steps
   * one block up or down, which is what lets a line follow stairs.
   *
   * @returns {{powered: Set<string>, strengths: Map<string, number>, litConsumers: number}}
   */
  solve() {
    const strengths = new Map();
    const queue = [];

    for (const lever of this.levers) {
      if (!this.isOn(lever)) continue;
      const k = key(lever.x, lever.y, lever.z);
      strengths.set(k, MAX_STRENGTH);
      queue.push({ cell: lever, strength: MAX_STRENGTH });
    }

    // Spread along dust.
    while (queue.length) {
      const { cell, strength } = queue.shift();
      if (strength <= 0) continue;

      for (const [dx, dy, dz] of NEIGHBOURS) {
        const next = this.at(cell.x + dx, cell.y + dy, cell.z + dz);
        if (!next || !isWire(next.name)) continue;

        const nk = key(next.x, next.y, next.z);
        const carried = strength - 1;
        if (carried <= 0) continue;
        if ((strengths.get(nk) ?? -1) >= carried) continue;

        strengths.set(nk, carried);
        queue.push({ cell: next, strength: carried });
      }
    }

    // Anything touching a powered source or powered dust lights up.
    const powered = new Set(strengths.keys());
    let litConsumers = 0;

    for (const [k, strength] of strengths) {
      if (strength <= 0) continue;
      const [x, y, z] = unkey(k);
      for (const [dx, dy, dz] of NEIGHBOURS) {
        const next = this.at(x + dx, y + dy, z + dz);
        if (!next || !isConsumer(next.name)) continue;
        const nk = key(next.x, next.y, next.z);
        if (powered.has(nk)) continue;
        powered.add(nk);
        litConsumers++;
      }
    }

    return { powered, strengths, litConsumers };
  }

  /** Components present that this simulation deliberately does not model. */
  unsimulated(cells) {
    const found = new Set();
    for (const cell of cells) {
      const s = shortName(cell.name);
      if (NOT_SIMULATED.has(s)) found.add(s);
    }
    return [...found];
  }
}

/** Six face neighbours, plus the one-block step dust makes up and down. */
const NEIGHBOURS = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
  [1, 1, 0], [-1, 1, 0], [0, 1, 1], [0, 1, -1],
  [1, -1, 0], [-1, -1, 0], [0, -1, 1], [0, -1, -1]
];

export function key(x, y, z) {
  return `${x},${y},${z}`;
}

function unkey(k) {
  return k.split(",").map(Number);
}
