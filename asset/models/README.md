# Jokoman 3D models

Drop `.glb` (or `.gltf`) files here and list them in `models.json` to replace the built-in
soldier and weapons. Anything missing or failing to load falls back to the built-in models, so
you can add one file at a time. The default `models.json` is empty (`{}`): built-in models only.

Copy `models.example.json` to `models.json` and keep only the entries you have files for.

## Soldier (`soldier`)

A rigged humanoid with animations. Mixamo characters work out of the box:

1. On mixamo.com pick a character, download it once **with skin** (FBX).
2. Download the animations **without skin**: idle, run, walk, crouch idle, crouch walk,
   death, jump. Rifle-holding versions ("Rifle Idle", "Rifle Run"...) look best.
3. Merge them into one `.glb` (e.g. Blender: import all FBX, put the actions on one armature,
   export glTF Binary with animations).

| Field | Meaning | Default |
| --- | --- | --- |
| `file` | file name in this folder | — |
| `height` | scaled to this height in meters | `1.75` |
| `yaw` | turn so the model faces forward (-Z); Mixamo faces +Z | `3.1416` |
| `animations` | clip name per action: `idle`, `walk`, `run`, `crouch`, `crouchWalk`, `death`, `jump` | matched by name (e.g. any clip with "run" in it) |
| `bones` | `spine`, `rightHand`, `leftArm` node names | Mixamo names are found automatically |
| `teamMaterials` | material names recolored to team red/blue (e.g. the vest) | none: a team armband is added |
| `teamColors` | `{ "red": "#b3342b", "blue": "#2f5fb3" }` as numbers or hex | |
| `aimSign` | flip if the upper body leans the wrong way when aiming up | `-1` |
| `weaponOffset` | `[x, y, z]` meters from the right hand to the gun grip | `[0.02, 0, -0.08]` |
| `runSpeed`, `walkSpeed` | m/s the run/walk clips were made for (playback speed) | `5.4`, `2.4` |

## Weapons (`weapons.rifle`, `pistol`, `knife`, `bomb`)

Plain models, no rig needed. Each is rotated, scaled and placed automatically:

| Field | Meaning | Default |
| --- | --- | --- |
| `file` | file name | — |
| `rotation` | `[x, y, z]` radians so the barrel points to -Z (barrel along +X → `[0, 1.5708, 0]`) | `[0, 0, 0]` |
| `length` | longest side in meters | rifle `0.9`, pistol `0.22`, knife `0.3`, bomb `0.24` |
| `offset` | `[x, y, z]` meters, nudges the grip onto the origin | `[0, 0, 0]` |
| `muzzle` | `[x, y, z]` of the barrel tip (muzzle flash) | front end of the model |
| `hands` | `{ "right": [x,y,z], "left": [x,y,z] }` where the first-person hands hold it | grip and handguard |
| `mag` | node name of the magazine (moves during reloads); `false` to disable | any node named like "magazine"/"mag" |
| `light` | node name of the bomb's LED | a red LED is added |

Keep files small (ideally under 3–5 MB each, textures 1024 px or less) so phones load quickly.
Only use models you have the rights to (your own, CC0, or a license that allows it in a game).

## Heroes (`heroes.<id>`)

Optional: give a hero its own character file. Same fields as `soldier` (anything left out is taken
from `soldier`). Hero ids: `asap`, `gerhana`, `kilat`, `bayang`, `banteng`, `garuda`, `ronda`,
`sonar`, `jamu`, `pelita`. Heroes without a file use the shared soldier.

```json
"heroes": {
  "banteng": { "file": "banteng.glb", "height": 1.85 },
  "kilat": { "file": "kilat.glb" }
}
```
