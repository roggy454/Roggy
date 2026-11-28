# Your own 3D models

Neon Coast can use real 3D models (`.glb` / `.gltf`) for **cars** and for **your player character**.
Everything else keeps working: physics, damage, lights, traffic, the walk/run/drive animation.

## Two ways to add a model

1. **Drag & drop** a `.glb` file onto the game window (or use *Menu → Your own 3D models*).
   - A car appears next to you — walk up and press **F** to drive it.
   - A rigged human replaces your character.
2. **Ship it with the game**: put the files in this folder and create `models/manifest.json`
   (copy `manifest.example.json`). Listed cars spawn near the start point; `player` replaces your character.

```json
{
  "cars": [
    { "file": "my-supercar.glb", "name": "My Supercar" },
    { "file": "pickup.glb", "name": "Pickup", "flip": true }
  ],
  "player": { "file": "me.glb" }
}
```

## What works best

**Cars**
- Any scale/orientation is fine — the model is fitted automatically (length along the road, wheels on
  the ground, real size if it's already in metres).
- Name the wheel meshes with `wheel`, `tire`, `tyre` or `rim` in the name and they will spin and steer.
  Physics (wheelbase, track, wheel size, mass class) is derived from the model's real dimensions.
- If a car drives backwards, press **B** while driving it (or set `"flip": true` in the manifest).
- Draco- and Meshopt-compressed files are supported.

**Characters**
- A humanoid with a skeleton (Mixamo, MakeHuman "game engine" rig, VRoid/VRM converted to glb, Unreal/Unity
  style rigs, Blender Rigify exports). T-pose or A-pose both work.
- Bones are matched by name (hips, spine, neck, head, upper arm, forearm, hand, thigh, shin/calf, foot);
  if something can't be matched the game tells you which bones are missing.

## Where to get models

- **Characters:** [MakeHuman](http://www.makehumancommunity.org/) (exports are CC0 — free to use for anything),
  [Mixamo](https://www.mixamo.com/) characters, or [VRoid Studio](https://vroid.com/en/studio) for your own avatar.
- **Cars:** [Sketchfab](https://sketchfab.com/) (filter by *Downloadable* and check the licence),
  [Poly Pizza](https://poly.pizza/), or models you make yourself in Blender.
- Check each model's licence before you share or publish the game. Models that copy a real manufacturer's car
  (its design, name or logo) usually can't be redistributed — original or generic designs are the safe choice.
