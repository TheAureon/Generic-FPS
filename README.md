# Generic FPS

A singleplayer first-person shooter that runs in your web browser. You fight AI bots.
It's built with [Three.js](https://threejs.org/) (3D graphics) and [Vite](https://vitejs.dev/) (development server).

> **Status:** Milestone 4 of 6. A free-for-all against 4 bots in the Foundry arena. Bots navigate the map, take cover, retreat, chase, and search.
> Game modes, menus, and pickups come in milestone 5; polish in milestone 6.

---

## How to run it (Mac)

### Quickest: double-click `Play.html`

Double-click **`Play.html`** in the project folder. It opens in your browser and runs the game. You don't need Terminal or Node.js.

> Don't open `index.html` directly. That file only works through the development server below, and opened on its own it just shows instructions.

`Play.html` is rebuilt at each milestone. If you change `src/config.ts`, use the development server below to see your changes, or run `npm run build:play` to rebuild `Play.html`.

### Development server (to tweak the game)

#### One-time setup

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

#### Every time you want to play

In Terminal:

```bash
cd ~/Desktop/Generic-FPS
npm run dev
```

Your browser opens the game automatically. If it doesn't, open <http://localhost:5173>.
To stop the game server, click the Terminal window and press **Ctrl+C**.

Chrome is recommended. Safari and Firefox also work.

#### Getting updates

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
| ` (or F3)      | Show or hide the info readout (frame rate, bot states) |
| B (or F4)      | Show or hide bot paths, the navigation graph, and bot state labels |

Click the game window to capture the mouse. Press Esc to get it back.

> Crouch is on **C** rather than Ctrl because on a Mac, Ctrl+W closes the browser tab.

---

## Tweaking the game

**All the gameplay numbers are in one file: [`src/config.ts`](src/config.ts).**
These include movement speed, jump height, gravity, crouch height, and head bob.
The `WEAPONS` section has each gun's damage, fire rate, magazine size, reload time, spread, recoil, zoom, and more.
The `BOTS` section sets bot speed, health, vision range and angle, and memory. `BOT_DIFFICULTY` sets reaction time, aim error, turn speed, burst length, and aggression for Easy, Normal, and Hard.
Until the match menu arrives in milestone 5, `testMatch` near the top picks the map, how many bots spawn, their difficulty, and whether bots also fight each other (`freeForAll`).
Each number has a comment explaining it. While `npm run dev` is running, save the file and the game reloads with the new values.

Mouse sensitivity, field of view, and volume will move to an in-game settings menu in milestone 5.

### Maps

Maps are defined as plain data in [`src/map/maps/`](src/map/maps/). Each map is a list of boxes (walls, floors, crates) and ramps with positions and sizes in meters, plus spawn points.
To add a map, copy `foundry.ts` (the main arena) or `testRoom.ts` (a small room), change the numbers, and add it to the list in `src/map/maps/index.ts`.

Bots find their way around any map automatically. When a map loads, the game scans it for every spot a bot can stand on, on every level, and links spots a bot can walk between. That includes ramps and drops off ledges. You don't need to place waypoints by hand. Press **B** in-game to see this navigation graph.

### How the bots think

Each bot runs a small state machine (`src/bots/BotBrain.ts`). Press **B** to see each bot's current state above its head:

| State | What the bot does |
| --- | --- |
| patrol | Walks between random spots, pausing to look around |
| investigate | Heard a gunshot (or was shot by someone it can't see): turns and goes to check |
| attack | Sees an enemy: aims (with reaction time and imperfect aim), fires in bursts, strafes, keeps its distance |
| cover | Under fire: runs to a nearby spot the enemy can't see, reloads, then peeks out |
| retreat | Low on health: runs to a hidden spot farther away, fighting back if cornered |
| chase | Lost sight of the enemy: goes to where it was last seen |
| search | Reached that spot and found nothing: checks a few places nearby, then goes back to patrolling |

---

### Sounds and models

All sounds are generated in code (`src/audio/sounds.ts`), and all models are built from simple shapes (`src/assets/`).
To use a real sound file instead, put it in a `public/sounds/` folder and list it in `SAMPLE_FILES` at the top of `src/audio/sounds.ts`.

## Project layout

```
src/
  config.ts          All tunable numbers
  main.ts            Entry point
  core/              Game loop, input, settings, collision, shared walking physics
  player/            Player movement, health, and armor
  bots/              Bot body, senses (Perception), aim, brain (state machine), navigation (NavGraph, Navigator), manager, debug view
  map/               Map format, map builder, and maps/ (map data)
  weapons/           Weapon logic, hitscan (bullet tracing), the gun in your hands
  entities/          Practice dummies
  effects/           Tracers, sparks, bullet holes
  audio/             Sound engine and procedural sound effects
  ui/                HUD, overlays, styles
  assets/            Textures, gun models, character model (made in code; swap in real files here later)
```

## Other commands

- `npm run build`: checks the code for errors and builds a production version into `dist/`
- `npm run build:play`: rebuilds the double-clickable `Play.html`
- `npm run preview`: serves that production build locally
