# Release notes

Versions run `vX.Y`. Every update bumps `Y` by one; when `Y` would reach 10 it rolls back to 0 and
`X` goes up by one, so v1.9 is followed by v2.0.

---

## v1.0

**Bedromatica — a Bedrock port of Litematica's capture half.**

Select any region in the world with the Schem Wand and save it as a real `.mcstructure` file
through the Schem Table. Capture only: it does not paste or ghost-preview structures.

### What it does

- **Schem Wand** — use it on a block to set Pos1, then on another block to set Pos2. A dotted
  outline follows your crosshair while you pick the second corner, so you see the exact region
  before committing. Clicking the same block twice is a valid 1×1×1 selection.
- **Charged wand** — once a region is captured the wand glows with an enchant shimmer and carries
  the snapshot with it. Its lore shows the corners and the size. Sneak + use resets it.
- **Schem Table** — right-click it with a charged wand to open the Schem Table screen, type a name,
  press Confirm. The region is written to `mystructure:<name>` and the wand empties out.
- **File path in chat** — every successful save prints where the `.mcstructure` landed, so you can
  go straight to it and copy it:
  `structures/mystructure/<name>.mcstructure` inside your world folder.
- **Bundling** — drop a saved file into `Bedromatica_BP/structures/mystructure/` and it ships with
  the addon, loading as `mystructure:<name>` in every world the pack is applied to.
- **Console shortcuts** — `/scriptevent bedromatica:status`, `bedromatica:confirm_save <name>` and
  `bedromatica:reset`.

### Requirements

Minecraft Bedrock **1.21.80** or newer. Built against the stable script modules
(`@minecraft/server` 1.19.0, `@minecraft/server-ui` 1.3.0), so **no experimental toggles are
needed** — leave Beta APIs off.

### Install

Download `Bedromatica-v1.0.mcaddon` from the repository root and open it; Minecraft imports both
packs. Then activate **Bedromatica** and **Bedromatica Resources** on your world.

`Bedromatica-v1.0.zip` holds the same two pack folders if you would rather drop them into
`com.mojang/development_behavior_packs` and `development_resource_packs` by hand.

### Limits

- Regions are capped at 64 × 384 × 64, the same ceiling a structure block has.
- All eight corners must be in loaded chunks.
- Pos1 and Pos2 have to be in the same dimension.
- Bedrock packs are read-only while the game runs, so the saved file goes to the world folder and
  copying it into the pack is a manual step.
