# Bedromatica

A Bedrock edition version of the original Litematica from Java edition, but I made some little bit
more changes to make it work — now you can use it just like the original version.

**Author:** Usersainyy · **Capture only** — Bedromatica selects a region and writes it out as an
`.mcstructure`. It does not paste or ghost-preview structures.

| | |
|---|---|
| Version | **v1.0** |
| Target | Minecraft Bedrock **1.21.80** and above (preview 1.21.80.26 / engine 26.13) |
| Script modules | `@minecraft/server` 1.19.0, `@minecraft/server-ui` 1.3.0 — both **stable**, no experiments |
| Namespace | `bedromatica:` |

Versions run `vX.Y`. Every update bumps `Y` by one; when `Y` would reach 10 it rolls back to 0 and
`X` goes up by one, so v1.9 is followed by v2.0.

## Schem Bench — the companion app

**[lhetvillanueva2000-maker.github.io/Bedromatica](https://lhetvillanueva2000-maker.github.io/Bedromatica/)**

Getting a `.mcstructure` off a phone normally means exporting the whole world and digging through
it. Schem Bench does that part for you: open the `.mcworld`, pick the build you want, tick off the
grass and dirt around it, save just that structure.

- **Pick one build, not the whole world.** Every structure in the export is listed; you choose.
- **Cut the clutter.** Ground, plants and water come pre-ticked for removal. Rock does not — stone
  and deepslate are building materials far too often to delete for you, so they are one tap away
  instead of a nasty surprise.
- **See it first.** A 3D hologram shows the build with the removed blocks as translucent ghosts, so
  you watch the structure separate from the ground before committing.
- **Trim to fit.** The box shrinks to the build. Air inside stays air, so rooms stay hollow and
  redstone gaps stay gaps. Stripped blocks become *structure void*, so pasting never punches a
  hole in your world.
- **Installs like an app.** Add it to your home screen: fullscreen, own icon, works offline.

Everything runs in the browser — no upload, no account, no server. Source in [`app/`](app).

## Download

| File | Use it for |
|---|---|
| [`Bedromatica-v1.0.mcaddon`](Bedromatica-v1.0.mcaddon) | One-tap install — open it and Minecraft imports both packs |
| [`Bedromatica-v1.0.zip`](Bedromatica-v1.0.zip) | Same contents, for dropping the two pack folders in by hand |

On GitHub, click the file then **Download raw file**. Both archives hold the same two packs.

---

## What's in the box

```
Bedromatica_BP/                              Bedromatica_RP/
├── manifest.json                            ├── manifest.json
├── pack_icon.png                            ├── pack_icon.png
├── scripts/                                 ├── textures/
│   ├── main.js                              │   ├── blocks/schem_table.png
│   ├── wand/                                │   ├── items/schem_wand.png
│   │   ├── wandHandler.js                   │   ├── items/schem_wand_icon.png
│   │   ├── selectionBox.js                  │   ├── particle/selection_line.png
│   │   └── structureCapture.js              │   ├── ui/schem_table_ui.png
│   ├── table/                               │   ├── item_texture.json
│   │   ├── tableInteract.js                 │   └── terrain_texture.json
│   │   └── tableUIHandler.js                ├── models/
│   └── utils/                               │   ├── blocks/schem_table.geo.json
│       ├── nbtStorage.js                    │   └── entity/schem_wand.geo.json
│       └── constants.js                     ├── attachables/
├── blocks/schem_table.json                  │   ├── schem_wand.attachable.json
├── items/                                   │   └── schem_wand_charged.attachable.json
│   ├── schem_wand.json                      ├── animations/schem_wand.animation.json
│   └── schem_wand_charged.json              ├── particles/selection_line.particle.json
├── structures/mystructure/                  ├── ui/
│   └── README.txt                           │   ├── schem_table_screen.json
└── texts/                                   │   ├── bedromatica_server_form.json
    ├── en_US.lang                           │   └── _ui_defs.json
    └── languages.json                       ├── texts/
                                             └── sounds/   (empty)
```

Every asset is already in place. The Blockbench geometry, the wand animations and the 1408×768
Schem Table artwork are the supplied files, unchanged apart from the `schem:` → `bedromatica:`
namespace swap on the item and attachable. The block and wand textures were taken straight out of
the supplied `.bbmodel` files, so their UVs line up with the models exactly.

Two files were generated rather than supplied and are meant to be replaced whenever you like:

| File | What it is |
|---|---|
| `RP/textures/items/schem_wand_icon.png` | 16×16 inventory sprite. The 64×64 `schem_wand.png` is the model's UV sheet and would look wrong as a flat icon, so the icon is its own file. Swap it and the atlas picks it up — `item_texture.json` already points `schem_wand` at it. |
| `*/pack_icon.png` | 128×128 pack thumbnail, made from the UI artwork. |

---

## Install

Drop the two folders into the Bedrock content directories, then apply both to a world.

| Platform | Behavior packs | Resource packs |
|---|---|---|
| Windows (release) | `%LOCALAPPDATA%\Packages\Microsoft.MinecraftUWP_8wekyb3d8bbwe\LocalState\games\com.mojang\development_behavior_packs\` | `…\development_resource_packs\` |
| Windows (preview) | `%LOCALAPPDATA%\Packages\Microsoft.MinecraftWindowsBeta_8wekyb3d8bbwe\LocalState\games\com.mojang\development_behavior_packs\` | `…\development_resource_packs\` |
| Android | `/storage/emulated/0/Android/data/com.mojang.minecraftpe/files/games/com.mojang/development_behavior_packs/` | `…/development_resource_packs/` |
| iOS | `Minecraft/games/com.mojang/development_behavior_packs/` (Files app) | `…/development_resource_packs/` |
| Dedicated server | `behavior_packs/` | `resource_packs/` |

Then in **Create/Edit World → Behavior Packs / Resource Packs**, activate **Bedromatica** and
**Bedromatica Resources**.

No experimental toggles are required. Leave *Beta APIs* **off** — this pack targets the stable
script modules on purpose.

To ship it as one file, zip the two folders together and rename the zip to `Bedromatica.mcaddon`.

---

## Using it in game

**1 — Get the tools.** Both are in the creative inventory: the **Schem Wand** under Equipment ▸
Tools, the **Schem Table** under Construction. Place the table wherever you want to do your saving.

**2 — Mark the first corner.** Hold the wand and use it on a block.

```
Pos1 set: (120, 64, -33)
```

A cyan dotted box appears immediately and follows your crosshair, so you can see the exact region
before you commit to it.

**3 — Mark the second corner.** Use the wand on the opposite corner.

```
Pos2 set: (140, 78, -12)
Selected Successfully (21x15x22)
```

The box turns blue and locks, the wand starts glowing with an enchant shimmer, and the region is
snapshotted right then. Hover the wand to see the corners and size in its lore.

Clicking the *same* block twice is fine — that is a valid 1×1×1 selection.

**4 — Save it.** Right-click the **Schem Table** with the glowing wand. The Schem Table screen opens
over the blueprint artwork with a name pre-filled from the region's dimensions. Type a name and
press **Confirm**.

```
Successful
Saved as mystructure:my_build
```

The wand loses its glow and empties out, ready for the next region.

**Reset at any time:** sneak + use the wand on any block → `Wand reset.`

### Where the .mcstructure file lands

The structure is saved exactly as `/structure save` writes it, under `mystructure:<your_name>`.
Every successful save prints the path in chat so you never have to hunt for it:

```
[Bedromatica] Saved mystructure:my_build
  file: structures/mystructure/my_build.mcstructure
```

That path is relative to your **world folder**:

| Platform | World folder |
|---|---|
| Windows (release) | `%LOCALAPPDATA%\Packages\Microsoft.MinecraftUWP_8wekyb3d8bbwe\LocalState\games\com.mojang\minecraftWorlds\<world id>\` |
| Windows (preview) | `%LOCALAPPDATA%\Packages\Microsoft.MinecraftWindowsBeta_8wekyb3d8bbwe\LocalState\games\com.mojang\minecraftWorlds\<world id>\` |
| Android | `/storage/emulated/0/Android/data/com.mojang.minecraftpe/files/games/com.mojang/minecraftWorlds/<world id>/` |
| iOS | `Minecraft/games/com.mojang/minecraftWorlds/<world id>/` (Files app) |
| Dedicated server | `worlds/<level name>/` |

Each `<world id>` folder has a `levelname.txt` naming the world, which is how you tell them apart.

Open `structures/mystructure/` in there and the `.mcstructure` files are sitting in it, ready to
copy.

### Bundling a structure with the mod

`Bedromatica_BP/structures/mystructure/` is the pack's own structure folder. Drop a saved
`.mcstructure` in there and it ships with Bedromatica — the pack loads it as `mystructure:<name>`
in every world the pack is applied to, without that world needing its own copy.

Bedrock packs are read-only while the game is running, so nothing can write into that folder from
in-game; the copy across is a manual step, which is why the addon prints the source path for you.

### Loading a saved structure

* **Structure block** — set one to Load and type `mystructure:my_build`.
* **Command** — `/structure load mystructure:my_build ~ ~ ~`.

Names are folded to the alphabet structure identifiers accept: lowercase, spaces become `_`, and
anything else is dropped. `My House!!` becomes `my_house`. Max 30 characters. Saving over an
existing name replaces it, same as the vanilla command.

### Console shortcuts

| Command | Effect |
|---|---|
| `/scriptevent bedromatica:status` | Prints the held wand's corners, snapshot id and charge state |
| `/scriptevent bedromatica:confirm_save <name>` | Saves the held selection without opening the table |
| `/scriptevent bedromatica:reset` | Empties the held wand |

---

## How the tricky parts work

Three things in this design cannot be done the obvious way on Bedrock. Each one is solved in the
code and worth knowing about before you edit it.

### The glint is two items, not a toggled component

`minecraft:glint` is static JSON. There is no script API that flips a component on a live
`ItemStack`. So "charging the wand" swaps the held stack between `bedromatica:schem_wand` and
`bedromatica:schem_wand_charged` — identical definitions apart from `glint`, sharing one geometry,
one texture and one animation set. The charged item has no `menu_category`, so it never shows up in
the creative inventory. `wandHandler.js` owns both stacks.

### The custom screen is bound to a server form

Bedrock has no API for opening a standalone JSON UI screen from script, and JSON UI buttons cannot
run commands, so "custom screen fires a scriptevent" is not a route the engine offers. What works —
and what every shipping add-on does — is to bind the custom screen to a server form:

1. `tableUIHandler.js` opens a `ModalFormData` titled `Bedromatica Schem Table`.
2. `RP/ui/bedromatica_server_form.json` patches the vanilla `custom_form` and `long_form` layouts
   with `modifications`, inserting the artwork behind the dialog and the CORE UNIT slot icons plus
   the diagnostics readout over the top. Every control it adds is gated on `#title_text`, so forms
   opened by vanilla or by any other add-on render exactly as they did before.
3. The player types into the form's own text field; the name comes back as `formValues[0]`.

Because the interactive parts are the form's own controls, nothing here depends on vanilla element
names. If a future update reshuffles the built-in UI and the artwork stops attaching, the fallback
is a plain text prompt — the addon keeps working, it just loses the skin. The painted X and Confirm
plate in the artwork are decoration; the form's real close and submit controls sit on top of them.

To re-tune where the artwork sits relative to the dialog, the offsets in
`RP/ui/schem_table_screen.json` are percentages of the 1408×768 image, listed next to each element.

### Data lives on the wand

`ItemStack` dynamic properties hold `pos1`, `pos2`, the snapshot id and the source dimension, so a
selection travels with the wand rather than with whoever clicked first — drop it, trade it, stash it
in a shulker box and the region is still attached to that stack. The four player-level properties
from the spec are still written as a mirror of the wand in the main hand; the particle renderer and
`bedromatica:status` read the mirror so neither has to walk inventories every tick.
`nbtStorage.js` is the only writer of both copies, which keeps them from drifting.

---

## Limits and edge cases

* **Region size** is capped at 64 × 384 × 64, the same ceiling a structure block has. Bigger
  selections are refused with `Selected Unsuccessfully` and the reason.
* **Unloaded chunks** are refused the same way — all eight corners have to be readable.
* **Outline particles** are one-shot with a 0.4 s lifetime, so the box fades on its own when you
  switch items, move the wand to your off-hand or reset it. Dot spacing widens automatically on big
  selections so a maximum-size region costs about the same as a small one, and dots more than 96
  blocks away are skipped.
* **Cross-dimension selections** are rejected: marking pos1 in the Overworld and pos2 in the Nether
  restarts the selection at the new corner instead of capturing nonsense.
* **Logging out mid-selection** clears the half-finished corner on rejoin. A *charged* wand keeps
  its data across logouts — that is the point of it.
* **Breaking the table** while the screen is open cancels quietly and leaves the wand charged.
* **Two players** selecting at once never collide; all state is per-item and per-player.
* A failed save always empties the wand, so you can never be left holding one that looks charged
  but is not.
* `minecraft:movable` (piston-immovable) needs 1.21.70+. On an older engine remove that component
  from `BP/blocks/schem_table.json`.

---

## License

MIT — see [LICENSE](LICENSE).
