# Custom 3D models

Drop model files in here and the game uses them instead of its built-in blocky models. Nothing else needs to change: run `npm run build` (or just reload the development server) and they're in.

## Guns

Put one `.glb` file per gun in `weapons/`, named after the gun:

| File | Gun |
|---|---|
| `weapons/pistol.glb` | Pistol |
| `weapons/rifle.glb` | Assault Rifle |
| `weapons/shotgun.glb` | Shotgun |
| `weapons/sniper.glb` | Sniper Rifle |
| `weapons/smg.glb` | SMG |
| `weapons/lmg.glb` | LMG |

A gun without a file keeps its built-in model, so you can add them one at a time. The model is used both in your hands and in the bots' hands.

The guns in `weapons/` now were made by `scripts/bake-weapons.mjs` from downloaded models (in `scripts/weapon-sources/`) that came as one solid piece: the script turns and sizes them, cuts out the moving parts, adds the markers below and names the materials for camos (`metal:…`, `dark:…`, `wood:…`; anything else isn't painted). Change its settings and run `node scripts/bake-weapons.mjs` to remake them.

### Preparing a model (e.g. in Blender)

- **Format:** `.glb` (binary glTF, textures packed inside). In Blender: File → Export → glTF 2.0, format "glTF Binary (.glb)".
- **Size:** real-world meters (a rifle is about 0.9 m long).
- **Direction:** the barrel points down **−Z** (away from the player), **+Y** is up. In Blender (Z-up), point the barrel along **+Y**: the glTF exporter turns Blender's +Y into −Z.
- **Origin:** roughly where the right hand holds the grip.

If a model comes out too big, too small, shifted or turned, fix it in `src/config.ts` → `WEAPON_MODELS` (scale, position, rotation) instead of re-exporting.

### Named parts (optional, but they make it look right)

Add empty objects (Blender: Add → Empty → Plain Axes) with these exact names, placed on the model:

| Name | What it marks |
|---|---|
| `muzzle` | Tip of the barrel (muzzle flash and bullet tracers start here). If missing, the front of the model is used. |
| `sight` | The point you look through when aiming down sights (rear sight or scope eyepiece center). |
| `eject` | Where spent shells pop out. |
| `grip_right` | Where the right hand holds the grip. |
| `grip_left` | Where the left hand holds the front (handguard, pump). |
| `grip_reload` | Where the left hand grabs the magazine (or pushes shotgun shells in). |
| `grip_slide` | Pistol: where the left hand grabs the slide to rack it. |
| `grip_cover` | LMG: where the left hand lifts the feed cover. |
| `grip_bolt` | Sniper: the bolt knob the right hand works. |

Moving parts: name the actual mesh (or a parent object containing it) like this and it will be animated:

| Name | Animation |
|---|---|
| `mag` | Comes out with the left hand during reloads. |
| `slide` | Pistol: pulled back and snaps forward at the end of a reload. |
| `pump` | Shotgun: racked back and forward after each shot. |
| `bolt` | Sniper: turned up, pulled back, pushed forward after each shot. Put its origin on the bore line so turning it swings the handle up. |
| `cover` | LMG: the feed cover flips up at the start of a reload and shuts at the end. Put its origin on the hinge (its front edge). |

### Tuning the animations

All first-person animation settings (where the gun sits, hand positions, reload keyframes and timings, pump/bolt/slide motion) are in `src/weapons/animations.ts`. Reload keyframes are fractions of each gun's reload time (set in `src/config.ts` → `WEAPONS`), so changing a reload time speeds up or slows down its animation automatically.

## Soldier

`soldier.glb` is the bots' body (and the kill-cam, menu and target-dummy soldiers). It was made by `scripts/bake-soldier.mjs` from `scripts/soldier-source/soldier.glb`, which came with no skeleton, standing with its arms out. The script:

- turns it to face −Z and scales it to 1.8 m, stretching the legs a little so the knees and hips line up with the game's skeleton;
- fits the game's bones inside it (`hips`, `lThigh`, `lKnee`, `rThigh`, `rKnee`, `spine`, `neck`, `lShoulder`, `lElbow`, `rShoulder`, `rElbow`). Each point follows its nearest bone, blending smoothly across the joints;
- lowers the arms, straightens the legs and tips the head up, into the standing pose the animations start from;
- smooths the shading (edges sharper than 40° stay sharp);
- splits it into parts named by what they are, which the game colors: `cloth`, `gear`, `plate`, `helmet`, `crest` (the top of the helmet, in the team color: the only thing that differs between teams), `mask`, `glove`, `boot`, `scarf`.

To use a different soldier, put it in `scripts/soldier-source/soldier.glb`, adjust the joint positions and the part names at the top of the script, and run `node scripts/bake-soldier.mjs`. A rigged model of your own also works if it has bones with the names above (standing straight, arms down, facing −Z, in meters), parts whose materials are named as above, and `userData.skeleton` with `hipsHeight`, `upperArm`, `forearm` and `thigh` lengths. Without `soldier.glb`, the game uses a soldier built from simple shapes.
