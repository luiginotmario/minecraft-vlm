import type { FromVision, ToVision, VisionFrame } from './protocol';

const CDN = 'https://storage.googleapis.com/mediapipe-models';
/** Frames are downscaled before inference; the models run at ~256px anyway. */
const INFER_WIDTH = 480;

/**
 * Streams webcam frames to the vision worker with backpressure: a new frame is
 * only sent once the previous result is back, so latency never builds up.
 */
export class CameraTracker {
  readonly video: HTMLVideoElement;
  private worker: Worker | null = null;
  private stream: MediaStream | null = null;
  private busy = false;
  private ready = false;
  private frameWaiting = false;
  private running = false;
  private resultTimes: number[] = [];
  delegate = '';
  inferMs = 0;
  latencyMs = 0;
  onResult?: (f: VisionFrame) => void;
  onStatus?: (s: string) => void;

  constructor(video: HTMLVideoElement) {
    this.video = video;
  }

  get active() {
    return this.running;
  }

  /** Results per second over the last second. */
  get hz() {
    const now = performance.now();
    while (this.resultTimes.length && now - this.resultTimes[0] > 1000) this.resultTimes.shift();
    return this.resultTimes.length;
  }

  async start() {
    if (this.running) return;
    this.onStatus?.('Requesting camera…');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60, min: 24 } },
    });
    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play();
    this.running = true;

    if (!this.worker) {
      this.onStatus?.('Loading hand and face models…');
      this.worker = new Worker(new URL('./vision.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<FromVision>) => this.handle(e.data);
      const base = new URL(import.meta.env.BASE_URL, location.href).href.replace(/\/$/, '');
      const init: ToVision = {
        t: 'init',
        wasmBase: `${base}/mediapipe`,
        handModel: `${base}/models/hand_landmarker.task`,
        faceModel: `${base}/models/face_landmarker.task`,
        fallbackHand: `${CDN}/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task`,
        fallbackFace: `${CDN}/face_landmarker/face_landmarker/float16/latest/face_landmarker.task`,
      };
      this.worker.postMessage(init);
    } else if (this.ready) {
      this.onStatus?.('');
    }
    this.watchFrames();
  }

  stop() {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  private handle(msg: FromVision) {
    if (msg.t === 'ready') {
      this.ready = true;
      this.delegate = msg.delegate;
      this.onStatus?.('');
      this.pump();
    } else if (msg.t === 'error') {
      this.onStatus?.(`Vision failed to load: ${msg.message}`);
    } else {
      this.busy = false;
      this.inferMs = msg.frame.ms;
      this.latencyMs = performance.now() - msg.frame.ts;
      this.resultTimes.push(performance.now());
      if (this.running) this.onResult?.(msg.frame);
      if (this.frameWaiting) this.pump();
    }
  }

  private watchFrames() {
    const v = this.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
    };
    if (v.requestVideoFrameCallback) {
      const onFrame = () => {
        if (!this.running) return;
        this.frameWaiting = true;
        this.pump();
        v.requestVideoFrameCallback!(onFrame);
      };
      v.requestVideoFrameCallback(onFrame);
    } else {
      const tick = () => {
        if (!this.running) return;
        this.frameWaiting = true;
        this.pump();
        setTimeout(tick, 16);
      };
      tick();
    }
  }

  private pump() {
    if (!this.ready || this.busy || !this.frameWaiting || !this.running || !this.worker) return;
    const vw = this.video.videoWidth, vh = this.video.videoHeight;
    if (!vw || !vh) return;
    this.busy = true;
    this.frameWaiting = false;
    const ts = performance.now();
    const w = Math.min(INFER_WIDTH, vw);
    const h = Math.round((w * vh) / vw);
    createImageBitmap(this.video, { resizeWidth: w, resizeHeight: h, resizeQuality: 'low' })
      .then((bitmap) => {
        const msg: ToVision = { t: 'frame', bitmap, ts };
        this.worker!.postMessage(msg, [bitmap]);
      })
      .catch(() => {
        this.busy = false;
      });
  }
}
