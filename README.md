# Neon Coast

An original open‑world city sandbox that runs in the browser, set in a Miami‑inspired coastal city
(downtown towers, a bay crossed by two causeways, and a beach island with an art‑deco strip).
Every car, person, building, texture and sound is generated procedurally at load time — there are
no downloaded models, images or audio files.

> This is a fan‑made, original project inspired by modern open‑world games. It does not use any
> assets, names, characters, logos or map data from any existing game. All car brands
> (VORTEK, AURELIA, KODIAK, PICO, MARLIN), hotels, streets and the city itself are fictional.

## Run it

It is a static site (ES modules + import map, Three.js and cannon‑es from a CDN), so any static
file server works:

```bash
npm start            # serves on http://localhost:8080
# or
python3 -m http.server 8080
```

Then open http://localhost:8080 and click **Click to play** (audio needs a click to start).
Opening `index.html` directly from disk will not work because browsers block ES modules on `file://`.

## Controls

| On foot | Driving | World |
|---|---|---|
| `WASD` move, mouse look | `W` gas, `S` brake / reverse | `V` camera mode, wheel zoom |
| `Shift` sprint, `Ctrl` walk | `A D` steer, `Space` handbrake | `Y` cycle weather |
| `Space` jump | `E` horn, `L` headlights | hold `T` fast time, `N` +3 h |
| `F` enter / exit a car | `Z X G` indicators / hazards | `Esc` menu (quality, time, weather, volume) |
| | `Q` radio, `R` flip car | `M` mute, `I` help |

Gamepads (standard mapping) and touch screens (on‑screen stick + buttons) are supported.

## What's in it

- **Rendering** — HDR pipeline with ACES tone mapping, bloom, colour grading, soft shadows,
  PBR materials with a sky‑driven environment map, MSAA (High/Ultra) or FXAA.
- **Day / night** — sun and moon move across the sky; at night the sky goes properly dark with
  stars, street lamps (real lights near the camera + light pools), lit windows, neon signs,
  LED tower crowns, aircraft beacons and car head/tail lights. Exposure adapts like eyes do.
- **Weather** — clear, cloudy, rain, thunderstorm and fog with smooth transitions and automatic
  changes. Rain streaks and splashes, wind that bends palms, lightning bolts with delayed thunder.
  Roads and sidewalks soak up water, darken, form puddles and turn into **mirrors** (planar
  reflections + rain ripples).
- **Water** — Gerstner waves (bigger in the open Atlantic, calm in the bay), planar reflections,
  turquoise shallows over the sloping beach, shoreline and crest foam, floating boats.
- **City** — ~170 procedural buildings (glass towers, condos with balconies, concrete mid‑rises,
  shop‑lined low‑rises, pastel art‑deco hotels with neon names), asphalt with lane markings,
  crosswalks, wear, cracks, oil stains and manholes, sidewalks with curbs, parks, parking lots.
- **5,000+ placed objects** — palms, shade trees and bushes (instanced, wind‑animated), street
  lamps, working traffic lights, hydrants, bins, benches, bus stops, meters, newsboxes, cones,
  barrels, lifeguard towers, beach umbrellas and loungers, café tables, billboards.
- **Physics** — cannon‑es rigid bodies. Cars use raycast suspension with a drivetrain model
  (torque curve, automatic gearbox, clutch slip, traction limit, brakes with bias, handbrake drift,
  aero drag and downforce, surface grip for wet asphalt / grass / sand, stability assist).
  Lamp posts snap, cones and bins scatter, hydrants burst, car bodies dent on impact.
- **Cars** — ten body styles (mid-engine supercar, GT coupe, muscle car, sedan, estate, hatchback,
  SUV, crew-cab pickup with an open bed, taxi, van) from six invented brands, each car randomly varied in
  proportions, wheel style and finish, built from scratch: lofted bodies with flush
  glass and frit, wheel arches, wrap‑around light clusters with projectors/LED/DRL/indicators,
  brake/reverse/third brake lights, grilles, badges, readable plates, mirrors, shut lines,
  multi‑part wheels with brake discs and calipers, interiors.
- **Grass** that tyres and feet flatten and push aside, recovering slowly afterwards.
- **People** — procedural skinned humans (varied height, build, skin tone, clothes, hair, faces)
  with procedural animation: walk/jog/sprint gait, idle, jump, swim, driving, knock‑down/get‑up.
- **AI** — traffic that keeps lanes, obeys signals, follows with a car‑following model, yields on
  left turns and honks; pedestrians that stroll, idle, dodge cars and sunbathe.
- **Audio** — fully synthesized: engine (RPM/load/cylinders, crackle, turbo), tyre screech,
  road and wind noise, surface‑aware footsteps, crashes, horns, rain, thunder, surf, birds,
  crickets, distant sirens and three procedural radio stations.

## Use your own 3D models

Drag a `.glb` car or rigged character onto the game window, or list models in `models/manifest.json`.
Cars become drivable with full physics; characters are animated by the game's own walk/run/drive system.
See [`models/README.md`](models/README.md).

## Project layout

```
index.html, style.css     page shell, HUD, menus
src/main.js               bootstrap, game loop, post-processing
src/core/                 textures, physics, input, camera, collision, shared uniforms
src/world/                map layout, roads, buildings, water, sky, weather, grass, props, fx
src/vehicles/             car models, vehicle physics, traffic AI
src/characters/           human generator, animation, retargeting, player, pedestrians
models/                   optional .glb cars/characters (see models/README.md)
src/audio/                synthesized audio + radio
src/ui/                   HUD and minimap
```
