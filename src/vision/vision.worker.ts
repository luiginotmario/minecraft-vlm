// Runs MediaPipe face + hand landmarking off the main thread.
import { FaceLandmarker, FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { FACE_IDS, type FromVision, type HandFrame, type ToVision } from './protocol';

let face: FaceLandmarker | null = null;
let hands: HandLandmarker | null = null;
let lastTs = 0;

const post = (msg: FromVision) => (self as unknown as Worker).postMessage(msg);

async function reachable(url: string) {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    const len = Number(r.headers.get('content-length') ?? '0');
    return r.ok && !(r.headers.get('content-type') ?? '').includes('text/html') && (len === 0 || len > 10_000);
  } catch {
    return false;
  }
}

// MediaPipe loads its wasm glue with import() in module workers and clears the
// global ModuleFactory after creating each task. Imports are cached, so the
// second task would find nothing; keep our own reference and restore it.
let factory: unknown = null;
async function restoreFactory(loaderPath: string) {
  if (!factory) factory = ((await import(/* @vite-ignore */ loaderPath)) as { default: unknown }).default;
  (self as unknown as { ModuleFactory: unknown }).ModuleFactory = factory;
}

async function create(msg: Extract<ToVision, { t: 'init' }>, delegate: 'GPU' | 'CPU') {
  const fileset = await FilesetResolver.forVisionTasks(msg.wasmBase, true);
  const handPath = (await reachable(msg.handModel)) ? msg.handModel : msg.fallbackHand;
  const facePath = (await reachable(msg.faceModel)) ? msg.faceModel : msg.fallbackFace;
  await restoreFactory(fileset.wasmLoaderPath);
  const h = await HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: handPath, delegate },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  await restoreFactory(fileset.wasmLoaderPath);
  const f = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: facePath, delegate },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
  });
  return { h, f };
}

async function init(msg: Extract<ToVision, { t: 'init' }>) {
  let delegate: 'GPU' | 'CPU' = 'GPU';
  try {
    ({ h: hands, f: face } = await create(msg, 'GPU'));
  } catch (err) {
    console.warn('[vision] GPU delegate failed, using CPU', err);
    delegate = 'CPU';
    try {
      ({ h: hands, f: face } = await create(msg, 'CPU'));
    } catch (err2) {
      post({ t: 'error', message: String((err2 as Error)?.message ?? err2) });
      return;
    }
  }
  // The first inference compiles GPU shaders (seconds). Do it now, behind the
  // loading message, instead of on the first real camera frame.
  try {
    const c = new OffscreenCanvas(480, 360);
    c.getContext('2d')!.fillRect(0, 0, 480, 360);
    const bm = c.transferToImageBitmap();
    lastTs = 1;
    hands!.detectForVideo(bm, lastTs);
    face!.detectForVideo(bm, lastTs);
    bm.close();
  } catch (err) {
    console.warn('[vision] warm-up failed', err);
  }
  post({ t: 'ready', delegate });
}

function frame(bitmap: ImageBitmap, ts: number) {
  if (!face || !hands) {
    bitmap.close();
    return;
  }
  // MediaPipe requires strictly increasing timestamps.
  const t = Math.max(ts, lastTs + 1);
  lastTs = t;
  const start = performance.now();
  const hr = hands.detectForVideo(bitmap, t);
  const fr = face.detectForVideo(bitmap, t);
  const ms = performance.now() - start;

  const handFrames: HandFrame[] = [];
  for (let i = 0; i < hr.landmarks.length; i++) {
    const lm = new Float32Array(63);
    const src = hr.landmarks[i];
    for (let j = 0; j < 21; j++) {
      lm[j * 3] = src[j].x;
      lm[j * 3 + 1] = src[j].y;
      lm[j * 3 + 2] = src[j].z;
    }
    handFrames.push({ lm, handed: hr.handedness[i]?.[0]?.categoryName ?? '' });
  }

  let faceArr: Float32Array | null = null;
  if (fr.faceLandmarks.length) {
    const src = fr.faceLandmarks[0];
    faceArr = new Float32Array(FACE_IDS.length * 3);
    for (let j = 0; j < FACE_IDS.length; j++) {
      const p = src[FACE_IDS[j]];
      faceArr[j * 3] = p.x;
      faceArr[j * 3 + 1] = p.y;
      faceArr[j * 3 + 2] = p.z;
    }
  }

  const w = bitmap.width, h = bitmap.height;
  bitmap.close();
  post({ t: 'result', frame: { ts, w, h, face: faceArr, hands: handFrames, ms } });
}

self.onmessage = (e: MessageEvent<ToVision>) => {
  const msg = e.data;
  if (msg.t === 'init') void init(msg);
  else if (msg.t === 'frame') {
    try {
      frame(msg.bitmap, msg.ts);
    } catch (err) {
      msg.bitmap.close();
      console.error('[vision] frame failed', err);
      post({ t: 'result', frame: { ts: msg.ts, w: 1, h: 1, face: null, hands: [], ms: 0 } });
    }
  }
};
