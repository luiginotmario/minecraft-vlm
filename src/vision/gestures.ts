import { OneEuro } from './filters';
import { F, type HandFrame, type VisionFrame } from './protocol';

export type GestureEvent = 'hit' | 'place' | 'next' | 'prev' | 'jump';

export interface GestureSettings {
  swing: boolean;
  push: boolean;
  swipe: boolean;
  pinch: boolean;
  jog: boolean;
  jump: boolean;
  lean: boolean;
  /** Multiplier on motion thresholds; higher = triggers with less movement. */
  sensitivity: number;
}

export const DEFAULT_GESTURES: GestureSettings = {
  swing: true,
  push: true,
  swipe: true,
  pinch: true,
  jog: true,
  jump: true,
  lean: false,
  sensitivity: 1,
};

// Thresholds. Hand speeds are in hand-sizes per second, so they don't depend
// on how far you stand from the camera. Face speeds are in face-heights/s.
export const T = {
  SWING_V: 7, // downward chop speed that counts as a hit
  SWING_DOMINANCE: 1.3, // vertical must beat horizontal by this much
  SWING_REARM_V: 2,
  SWING_LOST_FRACTION: 0.7, // hand vanished mid-swing (motion blur) at this fraction of SWING_V
  SWIPE_V: 6,
  SWIPE_DOMINANCE: 1.6,
  SWIPE_OPPOSITE_BLOCK_MS: 500, // ignore the return stroke after a swipe
  PUSH_RATE: 2.2, // d(log hand size)/dt toward the camera
  PUSH_REARM: 0.6,
  PINCH_ON: 0.3, // thumb–index tip gap, in palm lengths
  PINCH_OFF: 0.45,
  PINCH_INDEX_REACH: 0.5, // index tip must be this far from its knuckle (a fist folds it in)
  PINCH_MAX_SPEED: 4, // the pinch must start with the hand fairly still
  PINCH_AFTER_HIT_MS: 700, // an axe grip after a chop looks like a pinch; ignore it
  PINCH_FRAMES: 2, // held this many frames, so a passing finger brush doesn't count
  PINCH_RELAXED_FINGERS: 2, // of middle/ring/pinky not folded into the palm (an axe grip folds them)
  JOG_AMP: 0.06, // head bob amplitude (face heights) that counts as a step
  JOG_STEPS: 3, // bob crossings needed within the window to start moving
  JOG_WINDOW_MS: 1300,
  JOG_STOP_MS: 520,
  JOG_SPRINT_CADENCE: 5, // crossings per second
  JUMP_V: 2.6,
  JOG_PENALTY: 1.8, // swing and jump thresholds rise while jogging (arms pump, head bobs)
  LEAN_ON: 0.16,
  CALIBRATION_MS: 900,
};

const DEDUPE_MS: Record<GestureEvent, number> = { hit: 130, place: 250, next: 200, prev: 200, jump: 350 };

const WRIST = 0, THUMB_TIP = 4, INDEX_MCP = 5, INDEX_TIP = 8, MIDDLE_MCP = 9, RING_MCP = 13, PINKY_MCP = 17;
const FINGERS: [number, number][] = [
  [8, 6],
  [12, 10],
  [16, 14],
  [20, 18],
];

interface HandTrack {
  id: number;
  seen: number;
  prevSeen: number;
  cx: number;
  cy: number;
  size: number;
  /** Raw log-size history for a 3-sample slope. */
  logS: number[];
  logT: number[];
  vx: number;
  vy: number;
  vs: number;
  samples: number;
  fingers: number;
  pinched: boolean;
  pinchFired: boolean;
  /** This pinch began mid-motion or right after a hit; it can't place until released. */
  pinchBlocked: boolean;
  pinchFrames: number;
  swingArmed: boolean;
  swingT: number;
  swipeArmed: boolean;
  swipeDir: number;
  swipeT: number;
  pushArmed: boolean;
  pushT: number;
}

export interface HandView {
  id: number;
  fingers: number;
  pinched: boolean;
  vx: number;
  vy: number;
}

const dist2 = (lm: Float32Array, a: number, b: number, ar: number) => {
  const dx = (lm[a * 3] - lm[b * 3]) * ar;
  const dy = lm[a * 3 + 1] - lm[b * 3 + 1];
  return Math.sqrt(dx * dx + dy * dy);
};

/** 3D distance; hand z uses the same scale as x. */
const dist3 = (lm: Float32Array, a: number, b: number, ar: number) => {
  const dx = (lm[a * 3] - lm[b * 3]) * ar;
  const dy = lm[a * 3 + 1] - lm[b * 3 + 1];
  const dz = (lm[a * 3 + 2] - lm[b * 3 + 2]) * ar;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

export class GestureEngine {
  settings: GestureSettings;

  // Continuous outputs.
  faceVisible = false;
  /** Head yaw/pitch in degrees relative to the calibrated neutral; + is right / up. */
  yaw = 0;
  pitch = 0;
  /** 0 idle, 1 walk, 2 sprint. */
  jog = 0;
  /** -1 lean back, 0, 1 lean in. */
  lean = 0;
  calibrating = false;
  hands: HandView[] = [];

  private tracks: HandTrack[] = [];
  private nextId = 1;
  private yawF = new OneEuro(1.5, 0.06);
  private pitchF = new OneEuro(1.5, 0.06);
  private neutralYaw = 0;
  private neutralPitch = 0;
  private neutralFaceH = 0;
  private calib: { yaw: number[]; pitch: number[]; faceH: number[]; until: number } | null = null;
  private calibrated = false;

  // Jog / jump state.
  private bobBase = NaN;
  private bobState = 0;
  private bobSteps: number[] = [];
  private faceH = 0;
  private cyHist: number[] = [];
  private tHist: number[] = [];
  private jumpArmed = true;
  private jumpT = 0;

  constructor(settings: GestureSettings = { ...DEFAULT_GESTURES }) {
    this.settings = settings;
  }

  /** Start a neutral-pose calibration; it completes over the next frames. */
  calibrate() {
    this.calib = { yaw: [], pitch: [], faceH: [], until: -1 };
    this.calibrating = true;
  }

  get isCalibrated() {
    return this.calibrated;
  }

  update(frame: VisionFrame): GestureEvent[] {
    const events: GestureEvent[] = [];
    const ar = frame.w / frame.h;
    this.updateFace(frame, ar, events);
    this.updateHands(frame, ar, events);
    // One action per motion: a two-handed axe swing is two tracked hands
    // firing together, which should count once.
    return events.filter((e) => {
      if (frame.ts - this.lastEvent[e] < DEDUPE_MS[e]) return false;
      this.lastEvent[e] = frame.ts;
      return true;
    });
  }

  private lastEvent: Record<GestureEvent, number> = { hit: -1e9, place: -1e9, next: -1e9, prev: -1e9, jump: -1e9 };
  /** Last time any hand produced a hit (chop or punch), raw, before dedupe. */
  private lastHitT = -1e9;

  // ───────────────────────── face: look, jog, jump, lean ─────────────────────────

  private updateFace(frame: VisionFrame, ar: number, events: GestureEvent[]) {
    const p = frame.face;
    const t = frame.ts;
    if (!p) {
      this.faceVisible = false;
      this.jog = 0;
      this.lean = 0;
      this.yawF.reset();
      this.pitchF.reset();
      this.cyHist.length = 0;
      this.tHist.length = 0;
      this.bobBase = NaN;
      return;
    }
    this.faceVisible = true;
    const X = (i: number) => p[i * 3] * ar;
    const Y = (i: number) => p[i * 3 + 1];
    const Z = (i: number) => p[i * 3 + 2] * ar;

    // Face normal from the cheek-to-cheek and chin-to-forehead vectors.
    const rx = X(F.RIGHT) - X(F.LEFT), ry = Y(F.RIGHT) - Y(F.LEFT), rz = Z(F.RIGHT) - Z(F.LEFT);
    const ux = X(F.TOP) - X(F.CHIN), uy = Y(F.TOP) - Y(F.CHIN), uz = Z(F.TOP) - Z(F.CHIN);
    let nx = ry * uz - rz * uy;
    let ny = rz * ux - rx * uz;
    let nz = rx * uy - ry * ux;
    if (nz > 0) { nx = -nx; ny = -ny; nz = -nz; } // point toward the camera (-z)
    const rawYaw = (Math.atan2(-nx, -nz) * 180) / Math.PI;
    const rawPitch = (Math.atan2(-ny, Math.hypot(nx, nz)) * 180) / Math.PI;
    const faceH = Math.hypot(ux, uy);
    const sec = t / 1000;

    if (this.calib) {
      const c = this.calib;
      if (c.until < 0) c.until = t + T.CALIBRATION_MS;
      c.yaw.push(rawYaw);
      c.pitch.push(rawPitch);
      c.faceH.push(faceH);
      if (t >= c.until && c.yaw.length >= 5) {
        const med = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];
        this.neutralYaw = med(c.yaw);
        this.neutralPitch = med(c.pitch);
        this.neutralFaceH = med(c.faceH);
        this.calib = null;
        this.calibrating = false;
        this.calibrated = true;
        this.yawF.reset();
        this.pitchF.reset();
      }
      this.yaw = 0;
      this.pitch = 0;
    } else if (this.calibrated) {
      this.yaw = this.yawF.filter(rawYaw - this.neutralYaw, sec);
      this.pitch = this.pitchF.filter(rawPitch - this.neutralPitch, sec);
    }

    // Smoothed face height normalizes bob amplitude and speed.
    this.faceH = this.faceH ? this.faceH + (faceH - this.faceH) * 0.2 : faceH;
    const cy = (Y(F.TOP) + Y(F.CHIN)) / 2;

    // Lean in/out relative to the calibrated distance.
    if (this.settings.lean && this.calibrated && this.neutralFaceH > 0) {
      const r = this.faceH / this.neutralFaceH - 1;
      this.lean = r > T.LEAN_ON ? 1 : r < -T.LEAN_ON * 0.8 ? -1 : 0;
    } else {
      this.lean = 0;
    }

    // Jog in place: count zero crossings of the high-passed head height.
    const prevT = this.tHist.length ? this.tHist[this.tHist.length - 1] : t;
    const dt = Math.max(1, t - prevT) / 1000;
    if (Number.isNaN(this.bobBase)) this.bobBase = cy;
    this.bobBase += (cy - this.bobBase) * (1 - Math.exp(-dt / 0.35));
    const hp = (cy - this.bobBase) / this.faceH;
    const amp = T.JOG_AMP / this.settings.sensitivity;
    if (this.bobState <= 0 && hp > amp) {
      this.bobState = 1;
      this.bobSteps.push(t);
    } else if (this.bobState >= 0 && hp < -amp) {
      this.bobState = -1;
      this.bobSteps.push(t);
    }
    while (this.bobSteps.length && t - this.bobSteps[0] > T.JOG_WINDOW_MS) this.bobSteps.shift();
    const lastStep = this.bobSteps.length ? this.bobSteps[this.bobSteps.length - 1] : -Infinity;
    if (this.settings.jog && this.bobSteps.length >= T.JOG_STEPS && t - lastStep < T.JOG_STOP_MS) {
      const cadence = this.bobSteps.length / (T.JOG_WINDOW_MS / 1000);
      this.jog = cadence >= T.JOG_SPRINT_CADENCE ? 2 : 1;
    } else {
      this.jog = 0;
    }

    // Jump: a fast upward head movement (image y decreases).
    this.cyHist.push(cy);
    this.tHist.push(t);
    if (this.cyHist.length > 3) {
      this.cyHist.shift();
      this.tHist.shift();
    }
    if (this.cyHist.length >= 3) {
      const span = (this.tHist[2] - this.tHist[0]) / 1000;
      const v = (this.cyHist[2] - this.cyHist[0]) / span / this.faceH; // + is down
      const thr = (T.JUMP_V * (this.jog ? T.JOG_PENALTY : 1)) / this.settings.sensitivity;
      if (this.settings.jump && this.jumpArmed && -v > thr) {
        events.push('jump');
        this.jumpArmed = false;
        this.jumpT = t;
      } else if (!this.jumpArmed && -v < thr * 0.25 && t - this.jumpT > 350) {
        this.jumpArmed = true;
      }
    }
  }

  // ───────────────────────── hands: swing, swipe, punch, pinch ─────────────────────────

  private updateHands(frame: VisionFrame, ar: number, events: GestureEvent[]) {
    const t = frame.ts;
    const matched = new Set<HandTrack>();

    for (const h of frame.hands) {
      const lm = h.lm;
      const ids = [WRIST, INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP];
      let cx = 0, cy = 0;
      for (const i of ids) {
        cx += lm[i * 3] * ar;
        cy += lm[i * 3 + 1];
      }
      cx /= ids.length;
      cy /= ids.length;

      let best: HandTrack | null = null, bestD = 0.25;
      for (const tr of this.tracks) {
        if (matched.has(tr)) continue;
        const d = Math.hypot(tr.cx - cx, tr.cy - cy);
        if (d < bestD) { bestD = d; best = tr; }
      }
      const track = best ?? this.newTrack(cx, cy, t);
      matched.add(track);
      this.updateTrack(track, h, cx, cy, ar, t, events);
    }

    // Hands that vanished. A hand that disappears while chopping down fast is
    // almost always motion blur mid-swing, so count it as a hit.
    for (const tr of this.tracks) {
      if (matched.has(tr)) continue;
      if (
        this.settings.swing && tr.swingArmed && tr.samples >= 2 && t - tr.seen < 120 &&
        tr.vy > this.swingThreshold() * T.SWING_LOST_FRACTION && tr.vy > Math.abs(tr.vx) * T.SWING_DOMINANCE
      ) {
        events.push('hit');
        this.lastHitT = t;
        tr.swingArmed = false;
        tr.swingT = t;
      }
    }
    this.tracks = this.tracks.filter((tr) => matched.has(tr) || t - tr.seen < 250);

    this.hands = this.tracks
      .filter((tr) => matched.has(tr))
      .map((tr) => ({ id: tr.id, fingers: tr.fingers, pinched: tr.pinched, vx: tr.vx, vy: tr.vy }));
  }

  private swingThreshold() {
    return (T.SWING_V * (this.jog ? T.JOG_PENALTY : 1)) / this.settings.sensitivity;
  }

  private newTrack(cx: number, cy: number, t: number): HandTrack {
    const tr: HandTrack = {
      id: this.nextId++, seen: t, prevSeen: t, cx, cy, size: 0, logS: [], logT: [],
      vx: 0, vy: 0, vs: 0, samples: 0, fingers: 0, pinched: false, pinchFired: false, pinchBlocked: false, pinchFrames: 0,
      swingArmed: true, swingT: -1e9, swipeArmed: true, swipeDir: 0, swipeT: -1e9, pushArmed: true, pushT: -1e9,
    };
    this.tracks.push(tr);
    return tr;
  }

  private updateTrack(
    tr: HandTrack, h: HandFrame, cx: number, cy: number, ar: number, t: number, events: GestureEvent[],
  ) {
    const lm = h.lm;
    // Palm size, robust to rotation: wrist→middle knuckle or across the knuckles.
    const rawSize = Math.max(dist2(lm, WRIST, MIDDLE_MCP, ar), dist2(lm, INDEX_MCP, PINKY_MCP, ar) * 1.35);
    tr.size = tr.size ? tr.size + (rawSize - tr.size) * 0.3 : rawSize;

    let fingers = 0;
    for (const [tip, pip] of FINGERS) {
      if (dist2(lm, WRIST, tip, ar) > dist2(lm, WRIST, pip, ar) * 1.12) fingers++;
    }
    tr.fingers = fingers;

    // Pinch: thumb tip meets index tip. Measured in 3D so tips that merely
    // overlap in the image don't count. In a closed fist the thumb also rests
    // near the index, but the index tip is folded back to its knuckle.
    const palm3 = dist3(lm, WRIST, MIDDLE_MCP, ar);
    const pinchR = dist3(lm, THUMB_TIP, INDEX_TIP, ar) / palm3;
    const indexReach = dist3(lm, INDEX_TIP, INDEX_MCP, ar) / palm3;
    // Gripping an axe also brings thumb and index together, but curls the
    // other fingers into a fist; a pinch leaves them relaxed.
    let relaxed = 0;
    for (const [tip, pip] of FINGERS.slice(1)) {
      if (dist3(lm, WRIST, tip, ar) > dist3(lm, WRIST, pip, ar)) relaxed++;
    }
    const pinchShape = pinchR < T.PINCH_ON && indexReach > T.PINCH_INDEX_REACH && relaxed >= T.PINCH_RELAXED_FINGERS;
    if (!tr.pinched && pinchShape) {
      tr.pinched = true;
      tr.pinchFrames = 0;
      // Speed from the previous frame: was the hand already still when the fingers met?
      const moving = tr.samples > 0 && Math.hypot(tr.vx, tr.vy) >= T.PINCH_MAX_SPEED;
      tr.pinchBlocked = moving || t - this.lastHitT < T.PINCH_AFTER_HIT_MS;
    } else if (tr.pinched && pinchR > T.PINCH_OFF) {
      tr.pinched = false;
      tr.pinchFired = false;
      tr.pinchBlocked = false;
    }
    if (tr.pinched) tr.pinchFrames++;

    if (tr.samples > 0) {
      const dt = Math.max(1, t - tr.seen) / 1000;
      const rvx = (cx - tr.cx) / dt / tr.size;
      const rvy = (cy - tr.cy) / dt / tr.size;
      tr.vx += (rvx - tr.vx) * 0.7;
      tr.vy += (rvy - tr.vy) * 0.7;
    }
    tr.logS.push(Math.log(rawSize));
    tr.logT.push(t);
    if (tr.logS.length > 3) {
      tr.logS.shift();
      tr.logT.shift();
    }
    if (tr.logS.length === 3) {
      tr.vs = (tr.logS[2] - tr.logS[0]) / ((tr.logT[2] - tr.logT[0]) / 1000);
    }
    tr.prevSeen = tr.seen;
    tr.seen = t;
    tr.cx = cx;
    tr.cy = cy;
    tr.samples++;
    if (tr.samples < 2) return;

    const s = this.settings;
    const sens = s.sensitivity;
    const speed = Math.hypot(tr.vx, tr.vy);

    // Chop: fast downward motion. Fires on the threshold crossing, not the
    // peak, so the hit lands while your arm is still moving.
    const swingThr = this.swingThreshold();
    if (s.swing) {
      if (tr.swingArmed && tr.vy > swingThr && tr.vy > Math.abs(tr.vx) * T.SWING_DOMINANCE) {
        events.push('hit');
        this.lastHitT = t;
        tr.swingArmed = false;
        tr.swingT = t;
      } else if (!tr.swingArmed && tr.vy < T.SWING_REARM_V && t - tr.swingT > 140) {
        tr.swingArmed = true;
      }
    }

    // Swipe: fast sideways motion with fingers out. The camera image is
    // unmirrored, so moving your hand to your right decreases image x.
    if (s.swipe) {
      const thr = T.SWIPE_V / sens;
      const userVx = -tr.vx;
      if (
        tr.swipeArmed && Math.abs(userVx) > thr && Math.abs(userVx) > Math.abs(tr.vy) * T.SWIPE_DOMINANCE &&
        tr.fingers >= 2
      ) {
        const dir = Math.sign(userVx);
        const isReturn = dir === -tr.swipeDir && t - tr.swipeT < T.SWIPE_OPPOSITE_BLOCK_MS;
        if (!isReturn) {
          events.push(dir > 0 ? 'next' : 'prev');
          tr.swipeDir = dir;
          tr.swipeT = t;
        }
        tr.swipeArmed = false;
      } else if (!tr.swipeArmed && Math.abs(userVx) < thr * 0.3) {
        tr.swipeArmed = true;
      }
    }

    // Pinch is the only way to place: one block per deliberate pinch, started
    // with the hand still and not right after a chop. Release to place again.
    if (s.pinch && tr.pinched && !tr.pinchFired) {
      if (speed >= T.PINCH_MAX_SPEED || t - this.lastHitT < T.PINCH_AFTER_HIT_MS) tr.pinchBlocked = true;
    }
    if (s.pinch && tr.pinched && !tr.pinchFired && !tr.pinchBlocked && tr.pinchFrames >= T.PINCH_FRAMES) {
      events.push('place');
      tr.pinchFired = true;
    }

    // Punch toward the camera with a fist: hit.
    if (s.push && tr.logS.length === 3) {
      const thr = T.PUSH_RATE / sens;
      if (tr.pushArmed && tr.vs > thr && speed < this.swingThreshold() * 0.8) {
        if (tr.fingers <= 1) events.push('hit');
        this.lastHitT = t;
        tr.pushArmed = false;
        tr.pushT = t;
      } else if (!tr.pushArmed && tr.vs < T.PUSH_REARM && t - tr.pushT > 250) {
        tr.pushArmed = true;
      }
    }
  }
}
