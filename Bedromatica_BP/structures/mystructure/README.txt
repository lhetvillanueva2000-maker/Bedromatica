Bedromatica - bundled structures
================================

When you save a region with the Schem Table, Minecraft writes the file into
your WORLD folder, not here:

    <world folder>/structures/mystructure/<name>.mcstructure

Bedrock behavior packs are read-only while the game is running, so no addon
can write into this folder by itself. The game tells you the exact path in
chat every time a save succeeds, for example:

    [Bedromatica] Saved mystructure:my_build
      file: structures/mystructure/my_build.mcstructure

Copy that file into this folder and it ships with Bedromatica: the pack loads
it as mystructure:<name> in every world the pack is applied to, with no world
save needed.

Where the world folder is:

  Windows (release)  %LOCALAPPDATA%\Packages\Microsoft.MinecraftUWP_8wekyb3d8bbwe\
                     LocalState\games\com.mojang\minecraftWorlds\<world id>\
  Windows (preview)  %LOCALAPPDATA%\Packages\Microsoft.MinecraftWindowsBeta_8wekyb3d8bbwe\
                     LocalState\games\com.mojang\minecraftWorlds\<world id>\
  Android            /storage/emulated/0/Android/data/com.mojang.minecraftpe/
                     files/games/com.mojang/minecraftWorlds/<world id>/
  iOS                Minecraft/games/com.mojang/minecraftWorlds/<world id>/ (Files app)
  Dedicated server   worlds/<level name>/

The <world id> folder holds a levelname.txt naming the world, which is how you
tell them apart.
