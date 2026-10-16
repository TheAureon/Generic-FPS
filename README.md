# Generic FPS

A singleplayer first-person shooter that runs in your web browser. You fight AI bots.
It's built with [Three.js](https://threejs.org/) (3D graphics) and [Vite](https://vitejs.dev/) (development server).

> **Status:** Milestone 5 of 6. Full game: main menu, Deathmatch and Survival modes, pickups, minimap, pause/settings menus, and an end-of-match scoreboard.
> Visual and audio polish comes in milestone 6.

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
| Tab (hold)     | Scoreboard                      |
| Esc            | Pause menu (resume, restart, settings, quit) |
| ` (or F3)      | Show or hide the info readout (frame rate, bot states) |
| B (or F4)      | Show or hide bot paths, the navigation graph, and bot state labels |

Pick **Play** in the main menu, choose your match, and click **Start**. Press Esc at any time to pause and get your mouse back.

> Crouch is on **C** rather than Ctrl because on a Mac, Ctrl+W closes the browser tab.

---

## Tweaking the game

**All the gameplay numbers are in one file: [`src/config.ts`](src/config.ts).**
These include movement speed, jump height, gravity, crouch height, and head bob.
The `WEAPONS` section has each gun's damage, fire rate, magazine size, reload time, spread, recoil, zoom, and more.
The `BOTS` section sets bot speed, health, vision range and angle, and memory. `BOT_DIFFICULTY` sets reaction time, aim error, turn speed, burst length, and aggression for Easy, Normal, and Hard.
`MATCH` sets the menu's defaults, kill limits, and the Deathmatch time limit. `SURVIVAL` sets how waves grow, the break between waves, and the health you get back. `PICKUPS` sets how much health, armor, and ammo pickups give and how long they take to come back.
Each number has a comment explaining it. While `npm run dev` is running, save the file and the game reloads with the new values.

Mouse sensitivity, field of view, and volume are in the in-game **Settings** menu (from the main menu or the pause menu) and are remembered between visits.

## Game modes

- **Deathmatch**: everyone for themselves, bots included. First to the kill limit (10, 20, or 30) wins. If the 10-minute timer runs out first, the most kills wins. Everyone respawns a few seconds after dying.
- **Survival**: waves of bots hunt you. Wave 1 has the number of bots you choose, and each wave adds one more (up to 12). Bots get tougher each wave, faster and more accurate, until wave 6. You have one life. Clearing a wave gives you back 30 health. Your score is how many waves you survive.

Before each match you choose the mode, map, difficulty (Easy, Normal, Hard), and number of bots. Your choices are remembered for next time.

**Pickups** are spread around the map: health (red cross), armor (blue vest), and ammo (green crate). Walk over one to grab it. A pickup comes back 20–30 seconds after it's taken, and hurt bots will go for health too.

**The minimap** (top left) turns with you, so up is always the way you're facing. It shows walls and cover, pickups, and enemies you can see or that just fired. An enemy shown as a triangle is above or below you.

### Maps

Maps are defined as plain data in [`src/map/maps/`](src/map/maps/). Each map is a list of boxes (walls, floors, crates) and ramps with positions and sizes in meters, plus spawn points.
To add a map, copy `foundry.ts` (the main arena) or `testRoom.ts` (a small room), change the numbers, and add it to the list in `src/map/maps/index.ts`. New maps show up in the match menu automatically. Each map also lists its pickup spots (`pickups`).

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
  core/              Game loop and screens (Game), one match (Match), input, settings, collision, walking physics
  modes/             Deathmatch and Survival rules
  pickups/           Health, armor, and ammo pickups
  player/            Player movement, health, and armor
  bots/              Bot body, senses (Perception), aim, brain (state machine), navigation (NavGraph, Navigator), manager, debug view
  map/               Map format, map builder, and maps/ (map data)
  weapons/           Weapon logic, hitscan (bullet tracing), the gun in your hands
  entities/          Practice dummies
  effects/           Tracers, sparks, bullet holes
  audio/             Sound engine and procedural sound effects
  ui/                HUD, minimap, menus, styles
  assets/            Textures, gun/character/pickup models (made in code; swap in real files here later)
```

## Other commands

- `npm run build`: checks the code for errors and builds a production version into `dist/`
- `npm run build:play`: rebuilds the double-clickable `Play.html`
- `npm run preview`: serves that production build locally
