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

A gun without a file keeps its built-in model, so you can add them one at a time. The model is used both in your hands and in the bots' hands.

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

Moving parts: name the actual mesh (or a parent object containing it) like this and it will be animated:

| Name | Animation |
|---|---|
| `mag` | Comes out with the left hand during reloads. |
| `slide` | Pistol: pulled back and snaps forward at the end of a reload. |
| `pump` | Shotgun: racked back and forward after each shot. |
| `bolt` | Sniper: turned up, pulled back, pushed forward after each shot. Put its origin on the bore line so turning it swings the handle up. |

### Tuning the animations

All first-person animation settings (where the gun sits, hand positions, reload keyframes and timings, pump/bolt/slide motion) are in `src/weapons/animations.ts`. Reload keyframes are fractions of each gun's reload time (set in `src/config.ts` → `WEAPONS`), so changing a reload time speeds up or slows down its animation automatically.
