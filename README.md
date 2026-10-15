# Generic FPS

A singleplayer first-person shooter that runs in your web browser. You fight AI bots.
It's built with [Three.js](https://threejs.org/) (3D graphics) and [Vite](https://vitejs.dev/) (development server).

> **Status:** Milestone 2 of 6. You can move around a test room and shoot four weapons at practice dummies.
> Bots, game modes, and menus come in later milestones.

---

## How to run it (Mac)

### One-time setup

1. **Install Node.js.** Go to <https://nodejs.org>, download the **LTS** installer for macOS, and run it.
2. **Get the code.** Open the **Terminal** app (press Cmd+Space, type *Terminal*, press Enter) and paste:
   ```bash
   cd ~/Desktop
   git clone https://github.com/TheAureon/Generic-FPS.git Generic-FPS
   cd Generic-FPS
   git checkout claude/tender-rubin-0yqqrq
   ```
   If your Mac asks to install "command line developer tools", click **Install**, wait for it to finish, then paste the commands again.
3. **Install the game's libraries:**
   ```bash
   npm install
   ```

### Every time you want to play

In Terminal:

```bash
cd ~/Desktop/Generic-FPS
npm run dev
```

Your browser opens the game automatically. If it doesn't, open <http://localhost:5173>.
To stop the game server, click the Terminal window and press **Ctrl+C**.

Chrome is recommended. Safari and Firefox also work.

### Getting updates

When new milestones are pushed, run this in the `Generic-FPS` folder:

```bash
git pull
npm install
```

---

## Controls

| Key            | Action                          |
| -------------- | ------------------------------- |
| W A S D        | Move                            |
| Mouse          | Look around                     |
| Space          | Jump                            |
| Shift (hold)   | Sprint (while moving forward)   |
| C (hold)       | Crouch                          |
| Left click     | Shoot                           |
| Right click (hold) | Aim down sights (scope on the sniper) |
| R              | Reload                          |
| 1 2 3 4        | Pistol, assault rifle, shotgun, sniper rifle |
| Mouse wheel    | Next / previous weapon          |
| Q              | Switch back to the last weapon  |
| Esc            | Pause and free the mouse cursor |
| F3             | Show or hide the debug readout  |

Click the game window to capture the mouse. Press Esc to get it back.

> Crouch is on **C** rather than Ctrl because on a Mac, Ctrl+W closes the browser tab.

---

## Tweaking the game

**All the gameplay numbers are in one file: [`src/config.ts`](src/config.ts).**
These include movement speed, jump height, gravity, crouch height, and head bob.
The `WEAPONS` section has each gun's damage, fire rate, magazine size, reload time, spread, recoil, zoom, and more.
Each number has a comment explaining it. While `npm run dev` is running, save the file and the game reloads with the new values.

Mouse sensitivity, field of view, and volume will move to an in-game settings menu in milestone 5.

### Maps

Maps are defined as plain data in [`src/map/maps/`](src/map/maps/). Each map is a list of boxes (walls, floors, crates) and ramps with positions and sizes in meters.
To add a map, copy `testRoom.ts`, change the numbers, and add it to the list in `src/map/maps/index.ts`.

---

### Sounds and models

All sounds are generated in code (`src/audio/sounds.ts`), and all models are built from simple shapes (`src/assets/`).
To use a real sound file instead, put it in a `public/sounds/` folder and list it in `SAMPLE_FILES` at the top of `src/audio/sounds.ts`.

## Project layout

```
src/
  config.ts          All tunable numbers
  main.ts            Entry point
  core/              Game loop, input, settings, collision
  player/            Player movement
  map/               Map format, map builder, and maps/ (map data)
  weapons/           Weapon logic, hitscan (bullet tracing), the gun in your hands
  entities/          Practice dummies (bots come next)
  effects/           Tracers, sparks, bullet holes
  audio/             Sound engine and procedural sound effects
  ui/                HUD, overlays, styles
  assets/            Textures, gun models, character model (made in code; swap in real files here later)
```

## Other commands

- `npm run build`: checks the code for errors and builds a production version into `dist/`
- `npm run preview`: serves that production build locally
