# minecraft-vlm — spec

A lightweight voxel sandbox that runs locally in the browser, controlled by your body through the webcam. Keyboard and mouse still work for things the camera can't do (jumping, walking).

## Goals, in order

1. **Never laggy.** 60 fps render loop on a laptop iGPU. Vision runs off the main thread and never stalls rendering.
2. **Camera control feels instant.** Under 80 ms from motion to in-game response, smoothed with no jitter.
3. **Lightweight.** No game engine. Three.js plus MediaPipe Tasks Vision. Small bundle, `npm run dev` and it runs.

## Stack

- Vite + TypeScript + Three.js (plain, no R3F).
- `@mediapipe/tasks-vision`: FaceLandmarker for head pose, HandLandmarker for gestures/swings. Runs in a Web Worker on the GPU delegate where supported. Model files served locally from `public/models`, so it works offline.
- No backend. Static site.

## World and rendering

- Chunked voxel world (16×16×128 or similar), seeded simplex-noise terrain: grass, dirt, stone, sand, water, trees, ores.
- Greedy meshing in a Web Worker, so chunk build never blocks the frame. Texture atlas generated procedurally on a canvas, no image assets needed.
- Per-vertex ambient occlusion plus simple directional light and fog. Frustum culling, chunk load/unload by view distance.
- Player physics: AABB collision, gravity, jump, sprint.
- Block raycast (DDA) for targeting, with a highlight outline, break animation and particles, and block placing.
- Hotbar with 9 block types.

## Camera controls (the point of the project)

| Body action | Game action |
|---|---|
| Turn or tilt head (yaw/pitch from FaceLandmarker transform matrix) | Look around. Deadzone, then rate control past a threshold (like a joystick) so you can turn 360° while still looking at the screen. One-euro filter for smoothing. |
| Chopping/hitting swing with a hand (fast downward wrist velocity spike) | Mine / hit the targeted block. Repeated swings break harder blocks. |
| Push palm toward the camera (hand scale increases quickly) | Place block |
| Horizontal swipe with fingers (index tip velocity) | Next/previous hotbar slot |
| Pinch (thumb plus index) | Alternative hold-to-mine |
| Open palm held | Walk forward (optional, toggleable) |

- Calibration on start: look at the center of the screen for 1 s to set the neutral head pose.
- Small picture-in-picture webcam preview with landmarks and a live label of the last detected gesture, so it's obvious what fired.
- Settings panel: sensitivity, deadzone, enable/disable each gesture, mirror toggle.
- Everything works with keyboard and mouse too (WASD, space, mouse look via pointer lock, click to mine/place, 1–9 or scroll for hotbar).

## Performance rules

- Vision worker runs at its own cadence (~30 Hz) and posts compact landmark/gesture messages. The render loop only reads the latest result.
- No per-frame allocations in hot paths. Reuse vectors and typed arrays.
- Chunk meshing off thread, transferable buffers.
- Target: under 2 ms of main-thread JS per frame excluding draw.

## Done means

- `npm install && npm run dev` opens a playable world.
- Allowing the camera makes head look, swing-to-mine, swipe-to-switch, and push-to-place all work.
- A README explains the controls and how each gesture is detected.
