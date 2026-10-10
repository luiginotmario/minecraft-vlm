// Copies the MediaPipe wasm runtime into public/ and downloads the two
// landmarker models so the game runs fully offline after install.
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const wasmDst = join(root, 'public/mediapipe');
const modelDst = join(root, 'public/models');

const MODELS = {
  'hand_landmarker.task':
    'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task',
  'face_landmarker.task':
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task',
};

mkdirSync(wasmDst, { recursive: true });
mkdirSync(modelDst, { recursive: true });

if (existsSync(wasmSrc)) {
  for (const f of ['vision_wasm_module_internal.js', 'vision_wasm_module_internal.wasm']) {
    copyFileSync(join(wasmSrc, f), join(wasmDst, f));
  }
  console.log('[vision] copied wasm runtime');
}

for (const [name, url] of Object.entries(MODELS)) {
  const dst = join(modelDst, name);
  if (existsSync(dst) && statSync(dst).size > 100_000) continue;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(dst, Buffer.from(await res.arrayBuffer()));
    console.log(`[vision] downloaded ${name}`);
  } catch (err) {
    // Not fatal: the game falls back to loading models from the CDN.
    console.warn(`[vision] could not download ${name} (${err.message}); will load from CDN at runtime`);
  }
}
