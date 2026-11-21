# Roggy City

An open-world city game that runs in the browser (desktop and phone), built with three.js.
Everything (buildings, textures, cars, people, music) is generated in code, so there are no asset files to download.

## Play

Any static web server works. From the repository folder:

```sh
python3 -m http.server 8000
# or: npx serve .
```

Then open http://localhost:8000. Opening `index.html` straight from disk won't work, because browsers block ES modules on `file://`.

three.js loads from the jsDelivr CDN (pinned to 0.170.0), so the first load needs an internet connection.

## What's in it

**City and world**
- 8 x 8 block city: glass skyscrapers downtown, offices and modern apartments in midtown, brick buildings with ground-floor shops further out, three parks with a fountain, and two parking lots.
- Procedural PBR textures for asphalt, lane markings, crosswalks, sidewalk slabs, brick, concrete, curtain-wall glass and storefronts, with normal and roughness maps.
- Windows light up at night, each one on its own random schedule, and fewer stay lit after 1 am.
- Rolling hills, lakes, and mountains at the edge of the world. Forests of instanced trees, and GPU grass that sways in the wind.
- Full day/night cycle (one game hour = 50 s): sky dome, sun and moon, stars, matching fog, shadows, street lamps with light pools, bloom at night.

**Driving**
- Seven vehicle types: sedan, hatchback, SUV, sports car, taxi, panel van and pickup. Each body is lofted from cross-sections and has real wheel arches, projector headlights with LED daytime running lights, tail lights with separate brake, reverse and indicator sections, a third brake light, plates, mirrors, grille and trim.
- Rigid-body car physics: four raycast suspension struts, a slip-angle tyre model with a friction circle, weight transfer, anti-roll bars, an engine torque curve, an automatic 6-speed gearbox, brakes, handbrake drifts, and different grip on grass and pavement.
- Skid marks, tyre smoke, crash impulses, and a flip-back-over recovery.

**Traffic and people**
- NPC cars follow the lane graph and turn on smooth curves through intersections. They stop at red lights, yield before turning left, keep the intersection clear, follow the car ahead, stop for pedestrians, change lanes around parked cars, and honk when you block them.
- Hit an NPC car and it gets shoved, spins, then finds its way back into its lane.
- Pedestrians walk the sidewalks, wait for the walk signal before crossing, stand around on their phones, jump out of the way of speeding cars, and get back up if they're knocked down.
- Carjack any car: the driver bails out and runs off.
- Characters are skinned 3D models with procedural walk, run, idle, jump and fall animations.

**Radio**

Five live stations, all generated as you listen, so songs never repeat:

| Station | Genre |
| --- | --- |
| NEON 88.7 | Synthwave |
| LOW TIDE 94.1 | Lo-fi hip hop |
| PULSE 101.5 | House and techno |
| VELVET 97.3 | Late-night jazz |
| ROGGY TALK 104.9 | News and talk (uses your browser's speech voices) |

## Controls

| On foot | | Driving | |
| --- | --- | --- | --- |
| W A S D | Move | W / S | Throttle / brake, hold S to reverse |
| Shift | Sprint | A / D | Steer |
| Space | Jump | Space | Handbrake |
| F | Get in or steal a car | F | Get out |
| Mouse | Look | Q / E or mouse wheel | Change radio station |
| Wheel | Zoom | H | Horn |
| | | V | Camera (chase, far, hood) |
| | | L | Headlights |
| | | R | Flip the car upright |

Also: hold **T** to fast-forward time, **M** to mute, hold **Tab** to see the controls, **Esc** to pause.
Gamepads work too: left stick and triggers drive, Y gets in and out, the bumpers change the radio station.
On phones you get an on-screen stick and buttons.

## Graphics settings

Low, Medium and High are on the start screen and in the pause menu. Phones default to Low.
If the frame rate stays low, the game lowers its render resolution on its own.

## Code layout

| File | What it does |
| --- | --- |
| `src/main.js` | Boot, game loop, camera, entering and leaving cars, lights, HUD wiring |
| `src/city.js` | Road graph, blocks, buildings, street furniture, traffic signals, collision world |
| `src/terrain.js` | Heightfield, terrain mesh with blended materials, water |
| `src/textures.js`, `src/materials.js` | Procedural PBR textures and materials, including the window-light shader |
| `src/sky.js` | Day/night cycle, sky dome, sun and moon, fog, reflection environment map |
| `src/grass.js`, `src/trees.js` | GPU grass and instanced trees |
| `src/carModel.js` | Procedural car bodies, lights, wheels, plates |
| `src/vehicle.js` | Car physics, skid marks, tyre smoke, 2D collision helpers |
| `src/traffic.js` | NPC traffic AI |
| `src/human.js`, `src/pedestrians.js`, `src/player.js` | Skinned people and animation, pedestrian AI, the player on foot |
| `src/audio.js`, `src/radio.js` | Engine and effects synthesis, generative radio stations |
| `src/hud.js`, `src/input.js` | Minimap, speedometer, banners; keyboard, mouse, gamepad, touch |
