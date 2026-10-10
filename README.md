# minecraft-vlm

A small voxel sandbox that runs locally in the browser and is played with your body through the webcam. Turn your head to look, chop down to mine, push your palm forward to place a block, swipe to switch blocks, and jog in place to walk. Keyboard and mouse work too.

Everything runs on your machine. Camera frames never leave the browser.

## Run it

Requires Node 20.19+ or 22.12+ (see `.nvmrc`).

```bash
npm install
```

```bash
npm run dev
```

Open the printed URL in Chrome, Edge or Safari, then click **Play with camera**. `npm install` copies the MediaPipe runtime into `public/mediapipe` and downloads the two landmark models (~11 MB) into `public/models`. If that download fails, the game loads the models from Google's CDN at runtime instead.

## Controls

| Body | Action |
|---|---|
| Turn or tilt your head | Look around. Small movements map directly; hold your head turned past the deadzone and the view keeps turning, like a joystick. |
| Chop down fast with either hand, or both like an axe | Hit the block under the crosshair. Dirt breaks in one hit, wood in two, stone in three, ore in four. |
| Punch toward the camera with a fist | Hit |
| Push an open palm toward the camera | Place the selected block |
| Swipe sideways with fingers out | Next block (swipe to your right) or previous (to your left) |
| Pinch thumb and index, other fingers out (OK sign), and hold | Keep mining |
| Jog in place | Walk forward; jog faster to sprint |
| Hop | Jump |
| Lean toward the screen (off by default) | Walk forward |

| Keys | Action |
|---|---|
| WASD, Space, Shift | Move, jump, sprint |
| Mouse | Look (click to lock the pointer), left mine, right place |
| 1–9, scroll | Select block |
| F | Toggle flying (Space up, Shift down) |
| C | Recalibrate head pose |
| V | Camera on/off |
| F3 | Stats, including live hand speeds for tuning |
| Esc | Menu and settings |

When the camera starts, look at the screen and hold still for a second. That sets your neutral head pose. If you move your laptop or sit differently, press **C**.

The camera preview in the corner shows what the tracker sees: hand skeletons (yellow while pinching), face points, a head joystick (the inner disc is the deadzone), and whether you're walking.

## How the gestures are detected

MediaPipe's FaceLandmarker and HandLandmarker run in a Web Worker on the GPU (CPU fallback) and send back a few landmarks per frame. `src/vision/gestures.ts` turns those into game input:

- **Head look**: a face normal from the cheek-to-cheek and chin-to-forehead vectors (using landmark depth) gives yaw and pitch. They're calibrated against your neutral pose and smoothed with a One Euro filter, which keeps the view still when your head is still and responsive when it moves.
- **Hand motion**: palm centre velocity is measured in *hand sizes per second*, so thresholds don't depend on how far you sit from the camera.
- **Chop**: fires the moment downward speed crosses the threshold (not at the peak), so the hit lands mid-swing. If the hand disappears during a fast downward swing, which happens when motion blur makes it untrackable, that still counts as a hit.
- **Swipe**: must be mostly horizontal with at least two fingers out. The return stroke in the opposite direction is ignored for half a second.
- **Push and punch**: the rate of change of log hand size. An open palm places; a fist hits.
- **Jog**: head height is high-pass filtered and bob crossings are counted. Three within 1.3 s means walking; a high cadence means sprinting. While you jog, the chop and hop thresholds go up because your arms and head are already moving.
- **Hop**: a fast upward head movement.

All thresholds are in the `T` table at the top of `gestures.ts`. The Sensitivity slider in Settings scales them. `npm test` runs synthetic-landmark tests for every gesture, including false-positive cases such as slow movement, nodding and return strokes.

## Why it doesn't lag

- **Two workers.** Terrain generation and meshing run in one worker, vision in another. The render thread only uploads finished buffers, within a per-frame time budget.
- **Vision backpressure.** A new camera frame is sent only after the previous result is back, so latency never queues up. Inference is ~5 ms for face plus both hands on an M-series GPU, so the camera's frame rate is the limit. A 60 fps camera is used if available.
- **Greedy meshing** with per-vertex ambient occlusion: ~780 quads per chunk on average. Meshing a chunk takes ~2.5 ms off-thread, so a broken block disappears on the next frame.
- **Textures** are generated procedurally into a mipmapped texture array, so there are no image assets and no atlas bleeding.
- **No allocations** in the per-frame hot paths (raycast, physics, particles).

## Layout

```
src/
  main.ts               game loop, input, camera wiring
  world/                blocks, noise, terrain gen, greedy mesher, chunk worker, textures
  game/                 player physics, raycast, mining/placing
  render/               shaders, sky, clouds, held block, particles, crack overlay
  vision/               camera pump, vision worker, gesture engine, filters
  ui/                   HUD, camera preview, settings panel
test/gestures.test.ts   gesture engine tests on synthetic landmarks
```

Your world edits and settings are saved in `localStorage`. **New world** in Settings starts over.
