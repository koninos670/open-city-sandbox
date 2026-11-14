# Open City Sandbox

A 3D open-world crime sandbox that runs in the browser — drive and steal cars, walk and
shoot, hold up shops and banks, own a house, walk the beach, and outrun a 5-star police
pursuit in a procedurally built city. Built with plain JavaScript and a locally vendored copy
of three.js (no build step, no internet needed). Plays with a mouse and keyboard, or with
on-screen controls on a phone or tablet, and installs like an app.

> This is an original fan-style prototype inspired by open-world crime games. It shares
> no code, art or other assets with any commercial title.

## Play it online

**https://koninos670.github.io/open-city-sandbox/** — served over HTTPS by GitHub Pages
from this repository (`main` branch, root folder). No install, no server, works on desktop
and on mobile browsers that support WebGL.

## Play it offline

No install, no build step, no server:

1. Open the folder and double-click **index.html** (works from `file://` in Chrome, Edge,
   Firefox or Safari).
2. That's it — there is no start screen: the city is live as soon as the page loads. Click
   once to capture the mouse (the game plays fine without it too). Press `F1` or `?` for the
   key list.

Optional, if you prefer a local server:

```
cd <this folder>
python3 -m http.server 8000      # then open http://localhost:8000
```

## Controls

| Key / input | Action |
| --- | --- |
| `W` `A` `S` `D` | Walk / drive |
| `Shift` | Sprint (on foot) / handbrake (in a car) |
| `Space` | Jump |
| Mouse | Look |
| Left mouse | Fire |
| Right mouse | Aim (tighter spread) |
| `R` | Reload |
| `1` `2` `3` `4` | Pistol / SMG / Rifle / Shotgun |
| `E` | Enter or exit a car (also carjacks a driver) |
| `P` | Phone: map, cab, house waypoint, bank jobs, messages |
| `G` | Use what you are standing at: bed, fridge, TV, charger, shop counter |
| `F` | Car horn in a vehicle; on foot, start a hold-up when the gold marker is under you |
| `C` | Cycle camera (third person / first person / far) |
| `H` | Toggle first person |
| `M` | Mute audio |
| `F1` or `?` | Show / hide the key list (the game keeps running behind it) |
| `Esc` | Release the mouse (the game keeps running — click to capture it again) |

## Play on your phone

Open **https://koninos670.github.io/open-city-sandbox/** on the phone and the game shows its
own touch controls — no keyboard needed:

- **Left thumb** — the round stick: walk, and steer while you are driving.
- **Drag anywhere else** — look around / turn the camera. Holding the stick fully forward sprints.
- **FIRE / AIM / JUMP / RELOAD** — shoot, hold for a tighter aim, jump, reload.
- **CAR** — get in or out of the nearest car. **USE** — use what you are standing at.
- **ROB** — start a hold-up when the gold marker is under you.
- **GUN** — next weapon. **PHONE** — open the phone screen.

## Install it like an app

The game is a small installable web app (a PWA), so it can live on a home screen and open
full screen with no browser bars:

- **Android / PC (Chrome, Edge)** — open the live link, then press the browser's **Install**
  button (the little install icon in the address bar) or **Add to Home screen** in the menu.
- **iPhone / iPad (Safari)** — open the live link, tap **Share**, then **Add to Home Screen**.
- After it has loaded once it keeps working with no internet at all, and a new build always
  shows up on the next load.

## What's in the prototype

- **City**: a 30 × 30 block road grid (about 1.9 km across) with a downtown skyline,
  midtown, suburbs, hills, an industrial row, a beach and shoreline, parks, sidewalks,
  lane markings and crossings, day/night cycle with moving sun and matching fog, minimap.
- **People**: pedestrians who stroll around and panic-flee from gunfire and speeding cars.
- **Cars**: traffic that drives the road grid, stops for each other, brake lights; hijack
  any car (the driver bails out) and drive it with arcade physics, damage, smoke and fire.
- **Guns**: four weapons, hitscan shooting aligned to the crosshair, tracers, impact FX,
  reloading, damage to cars and people.
- **Heists**: 26 robbery targets scattered over the city — 4 banks, 6 jewellers, 10 corner
  stores and 6 ATMs (the minimap marks them in gold). Stand on the gold marker on foot and
  hold `F`: a ring and a light beam appear and you have to stay inside the marker until the
  job is done. Each job pays its own loot ($320–$6,500) and pushes your wanted level up;
  walk away early and you lose the job. Each target goes cold for a few minutes after.
- **Police**: 1–5 wanted stars, decaying heat, patrol response scaled to your star level,
  police cars that chase and ram, officers that shoot on foot, sirens, helicopter at high
  stars, arrest/bust flow and a hospital respawn that costs cash.
- **Phone**: press `P` for a full-screen smartphone — a home screen with your house waypoint,
  a cab you can call (the beach is a destination), a job map that paints a marker on the
  minimap, a bank screen, messages and settings. The battery drains while the screen is up
  (charge it at home) and the phone takes over the keyboard while it is open.
- **Home**: you own a house in the suburbs with a garden, a driveway and a front door. Inside
  there is a bed (`G` to sleep until morning), a fridge, a TV that reports the news, and a
  charger for the phone. The minimap marks the house with a green square.
- **Shops you can walk into**: banks, jewellers and corner stores have doorways you can walk
  through into a room with a counter, shelves, display cases, a safe and interior lighting.
  The hold-up marker is inside too, so you can rob the place from within.
- **Beach**: a sand shoreline with palms, umbrellas, benches and lamps, a promenade sea wall
  with steps down to the sand, and a long wooden pier out over the water.
- **HUD**: health/armor, weapon and ammo, cash, clock, district name, wanted stars,
  minimap (with home and waypoint pins), toasts and prompts.

## Notes

- Audio is synthesized at runtime with the Web Audio API (no audio files).
- No start screen and no pause: loading the page drops you straight into the city, and the
  game keeps simulating while the mouse is free.
- No save games yet; reloading the page starts a new session.
- `lib/three.min.js` is three.js r149 (MIT), vendored so the game runs fully offline.
- `manifest.webmanifest`, `icons/` and `sw.js` are what make the game installable. The service
  worker fetches from the network first: a new build shows up on the next load, and the cache
  is only used when the device is offline.
