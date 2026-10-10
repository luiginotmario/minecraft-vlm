import { describe, expect, it } from 'vitest';
import { GestureEngine, type GestureEvent } from '../src/vision/gestures';
import type { HandFrame, VisionFrame } from '../src/vision/protocol';

const W = 640, H = 480, AR = W / H;
const DT = 1000 / 30;

// Canonical face points (aspect-corrected units, y down, z toward the camera
// is negative), in FACE_IDS order: nose, left cheek, right cheek, forehead,
// chin, eye L, eye R, mouth.
const FACE_PTS: [number, number, number][] = [
  [0, 0.05, -0.12], [-0.45, 0, 0.05], [0.45, 0, 0.05], [0, -0.55, 0],
  [0, 0.5, -0.03], [-0.2, -0.12, -0.02], [0.2, -0.12, -0.02], [0, 0.25, -0.08],
];

/** yaw > 0: user turns to their right; pitch > 0: user looks up. */
function face(yawDeg: number, pitchDeg: number, cx = 0.5, cy = 0.45, scale = 0.2): Float32Array {
  const y = (yawDeg * Math.PI) / 180, p = (pitchDeg * Math.PI) / 180;
  const out = new Float32Array(FACE_PTS.length * 3);
  FACE_PTS.forEach(([x0, y0, z0], i) => {
    // Pitch about x, then yaw about y.
    const y1 = y0 * Math.cos(p) + z0 * Math.sin(p);
    const z1 = -y0 * Math.sin(p) + z0 * Math.cos(p);
    const x2 = x0 * Math.cos(y) + z1 * Math.sin(y);
    const z2 = -x0 * Math.sin(y) + z1 * Math.cos(y);
    out[i * 3] = (cx * AR + x2 * scale) / AR;
    out[i * 3 + 1] = cy + y1 * scale;
    out[i * 3 + 2] = (z2 * scale) / AR;
  });
  return out;
}

type Pose = 'open' | 'fist' | 'pinch' | 'axe';
const OPEN: [number, number][] = [
  [0, 0.5], [-0.3, 0.3], [-0.5, 0.1], [-0.65, -0.1], [-0.8, -0.25],
  [-0.25, -0.45], [-0.3, -0.85], [-0.32, -1.05], [-0.34, -1.25],
  [0, -0.5], [0, -0.95], [0, -1.18], [0, -1.4],
  [0.22, -0.45], [0.25, -0.85], [0.27, -1.05], [0.28, -1.22],
  [0.42, -0.38], [0.48, -0.7], [0.5, -0.88], [0.52, -1.02],
];

function hand(cx: number, cy: number, size: number, pose: Pose = 'open'): HandFrame {
  const pts = OPEN.map((p) => [...p] as [number, number]);
  if (pose === 'fist' || pose === 'axe') {
    for (const [mcp, f] of [[5, -0.27], [9, 0], [13, 0.24], [17, 0.44]] as const) {
      pts[mcp + 1] = [f, -0.7];
      pts[mcp + 2] = [f, -0.5];
      pts[mcp + 3] = [f, -0.35];
    }
    pts[4] = [-0.3, -0.1];
    if (pose === 'axe') {
      // Gripping a handle: index wraps round to meet the thumb, the rest stay folded.
      pts[6] = [-0.4, -0.8];
      pts[7] = [-0.55, -0.88];
      pts[8] = [-0.6, -0.85];
      pts[4] = [-0.6, -0.82];
    }
  } else if (pose === 'pinch') {
    // Index bends to meet the thumb; the tip stays well away from its knuckle.
    pts[6] = [-0.38, -0.85];
    pts[7] = [-0.45, -0.95];
    pts[8] = [-0.5, -0.95];
    pts[4] = [-0.52, -0.92];
  }
  const lm = new Float32Array(63);
  pts.forEach(([x, y], i) => {
    lm[i * 3] = (cx * AR + x * size) / AR;
    lm[i * 3 + 1] = cy + y * size;
  });
  return { lm, handed: 'Right' };
}

class Sim {
  g = new GestureEngine();
  t = 1000;
  events: GestureEvent[] = [];
  step(f: Float32Array | null, hands: HandFrame[] = []) {
    const frame: VisionFrame = { ts: this.t, w: W, h: H, face: f, hands, ms: 5 };
    this.events.push(...this.g.update(frame));
    this.t += DT;
  }
  calibrate() {
    this.g.calibrate();
    for (let i = 0; i < 35; i++) this.step(face(0, 0));
    expect(this.g.isCalibrated).toBe(true);
    this.events = [];
  }
  count(e: GestureEvent) {
    return this.events.filter((x) => x === e).length;
  }
}

describe('head look', () => {
  it('reports turn and tilt with the right signs and roughly the right size', () => {
    const s = new Sim();
    s.calibrate();
    for (let i = 0; i < 30; i++) s.step(face(20, 0));
    expect(s.g.yaw).toBeGreaterThan(15);
    expect(s.g.yaw).toBeLessThan(25);
    expect(Math.abs(s.g.pitch)).toBeLessThan(3);
    for (let i = 0; i < 30; i++) s.step(face(-15, 12));
    expect(s.g.yaw).toBeLessThan(-10);
    expect(s.g.pitch).toBeGreaterThan(8);
  });

  it('subtracts the calibrated neutral pose', () => {
    const s = new Sim();
    s.g.calibrate();
    for (let i = 0; i < 35; i++) s.step(face(8, -10)); // camera off-centre, above the screen
    for (let i = 0; i < 20; i++) s.step(face(8, -10));
    expect(Math.abs(s.g.yaw)).toBeLessThan(1);
    expect(Math.abs(s.g.pitch)).toBeLessThan(1);
  });

  it('is stable when still (no jitter amplification)', () => {
    const s = new Sim();
    s.calibrate();
    const vals: number[] = [];
    for (let i = 0; i < 60; i++) {
      const n = (Math.random() - 0.5) * 1.0; // ±0.5° landmark noise
      s.step(face(n, n));
      vals.push(s.g.yaw);
    }
    const tail = vals.slice(20);
    expect(Math.max(...tail) - Math.min(...tail)).toBeLessThan(0.8);
  });
});

describe('jog, jump, lean', () => {
  it('walks while jogging in place and stops shortly after', () => {
    const s = new Sim();
    s.calibrate();
    for (let i = 0; i < 60; i++) {
      const cy = 0.45 + Math.sin(((i * DT) / 1000) * 2 * Math.PI * 2.0) * 0.025;
      s.step(face(0, 0, 0.5, cy));
    }
    expect(s.g.jog).toBeGreaterThan(0);
    expect(s.count('jump')).toBe(0);
    for (let i = 0; i < 25; i++) s.step(face(0, 0));
    expect(s.g.jog).toBe(0);
  });

  it('sprints at a high cadence', () => {
    const s = new Sim();
    s.calibrate();
    for (let i = 0; i < 60; i++) {
      const cy = 0.45 + Math.sin(((i * DT) / 1000) * 2 * Math.PI * 3.0) * 0.03;
      s.step(face(0, 0, 0.5, cy));
    }
    expect(s.g.jog).toBe(2);
  });

  it('does not walk when talking or nodding slightly', () => {
    const s = new Sim();
    s.calibrate();
    for (let i = 0; i < 90; i++) {
      const cy = 0.45 + Math.sin(i * 0.9) * 0.004;
      s.step(face(0, Math.sin(i * 0.3) * 4, 0.5, cy));
    }
    expect(s.g.jog).toBe(0);
    expect(s.count('jump')).toBe(0);
  });

  it('jumps on a quick hop, once', () => {
    const s = new Sim();
    s.calibrate();
    const path = [0.45, 0.45, 0.4, 0.33, 0.29, 0.29, 0.33, 0.4, 0.45, 0.45, 0.45];
    for (const cy of path) s.step(face(0, 0, 0.5, cy));
    expect(s.count('jump')).toBe(1);
  });

  it('leans in to walk when enabled', () => {
    const s = new Sim();
    s.g.settings.lean = true;
    s.calibrate();
    for (let i = 0; i < 30; i++) s.step(face(0, 0, 0.5, 0.45, 0.25));
    expect(s.g.lean).toBe(1);
  });
});

describe('hands', () => {
  const still = () => face(0, 0);

  it('chop down = one hit per swing, none on the way back up', () => {
    const s = new Sim();
    s.calibrate();
    const size = 0.1;
    for (let rep = 0; rep < 3; rep++) {
      let y = 0.3;
      for (let i = 0; i < 8; i++) s.step(still(), [hand(0.6, y, size, 'fist')]);
      for (let i = 0; i < 6; i++) { y += 0.05; s.step(still(), [hand(0.6, y, size, 'fist')]); } // ~1.5 H/s down
      for (let i = 0; i < 6; i++) s.step(still(), [hand(0.6, y, size, 'fist')]);
      for (let i = 0; i < 15; i++) { y -= 0.02; s.step(still(), [hand(0.6, y, size, 'fist')]); } // slow raise
    }
    expect(s.count('hit')).toBe(3);
  });

  it('counts a swing whose hand vanishes mid-motion (motion blur)', () => {
    const s = new Sim();
    s.calibrate();
    let y = 0.3;
    for (let i = 0; i < 5; i++) s.step(still(), [hand(0.6, y, 0.1, 'fist')]);
    y += 0.02; s.step(still(), [hand(0.6, y, 0.1, 'fist')]);
    y += 0.025; s.step(still(), [hand(0.6, y, 0.1, 'fist')]); // speeding up, still below threshold
    s.step(still(), []); // lost
    expect(s.count('hit')).toBe(1);
  });

  it('ignores slow movement', () => {
    const s = new Sim();
    s.calibrate();
    for (let i = 0; i < 60; i++) {
      s.step(still(), [hand(0.4 + Math.sin(i / 10) * 0.15, 0.5 + Math.cos(i / 10) * 0.1, 0.1)]);
    }
    expect(s.events).toEqual([]);
  });

  it('swipe to your right selects next, and the return stroke is ignored', () => {
    const s = new Sim();
    s.calibrate();
    let x = 0.7;
    for (let i = 0; i < 6; i++) s.step(still(), [hand(x, 0.5, 0.1)]);
    for (let i = 0; i < 5; i++) { x -= 0.05; s.step(still(), [hand(x, 0.5, 0.1)]); } // image-left = user-right
    for (let i = 0; i < 3; i++) s.step(still(), [hand(x, 0.5, 0.1)]);
    for (let i = 0; i < 5; i++) { x += 0.04; s.step(still(), [hand(x, 0.5, 0.1)]); } // quick return
    expect(s.count('next')).toBe(1);
    expect(s.count('prev')).toBe(0);
    // A deliberate swipe the other way later still works.
    for (let i = 0; i < 25; i++) s.step(still(), [hand(x, 0.5, 0.1)]);
    for (let i = 0; i < 5; i++) { x += 0.05; s.step(still(), [hand(x, 0.5, 0.1)]); }
    expect(s.count('prev')).toBe(1);
  });

  it('swipe does not also fire a hit, and a chop does not swipe', () => {
    const s = new Sim();
    s.calibrate();
    let x = 0.7;
    for (let i = 0; i < 6; i++) s.step(still(), [hand(x, 0.5, 0.1)]);
    for (let i = 0; i < 5; i++) { x -= 0.05; s.step(still(), [hand(x, 0.5 + i * 0.005, 0.1)]); }
    expect(s.count('hit')).toBe(0);
    let y = 0.3;
    for (let i = 0; i < 20; i++) s.step(still(), [hand(0.5, y, 0.1)]);
    for (let i = 0; i < 5; i++) { y += 0.05; s.step(still(), [hand(0.5 + i * 0.004, y, 0.1)]); }
    expect(s.count('next') + s.count('prev')).toBe(1);
    expect(s.count('hit')).toBe(1);
  });

  it('pushing an open palm does nothing; punching with a fist hits', () => {
    const s = new Sim();
    s.calibrate();
    let size = 0.09;
    for (let i = 0; i < 6; i++) s.step(still(), [hand(0.5, 0.5, size)]);
    for (let i = 0; i < 4; i++) { size *= 1.12; s.step(still(), [hand(0.5, 0.5, size)]); }
    for (let i = 0; i < 6; i++) s.step(still(), [hand(0.5, 0.5, size)]);
    expect(s.events).toEqual([]);
    for (let i = 0; i < 12; i++) { size /= 1.05; s.step(still(), [hand(0.5, 0.5, size, 'fist')]); }
    for (let i = 0; i < 6; i++) s.step(still(), [hand(0.5, 0.5, size, 'fist')]);
    for (let i = 0; i < 4; i++) { size *= 1.12; s.step(still(), [hand(0.5, 0.5, size, 'fist')]); }
    expect(s.count('hit')).toBe(1);
    expect(s.count('place')).toBe(0);
  });

  it('each pinch places exactly one block', () => {
    const s = new Sim();
    s.calibrate();
    for (let rep = 0; rep < 3; rep++) {
      for (let i = 0; i < 5; i++) s.step(still(), [hand(0.5, 0.5, 0.1, 'open')]);
      for (let i = 0; i < 10; i++) s.step(still(), [hand(0.5, 0.5, 0.1, 'pinch')]); // held: still one
    }
    expect(s.count('place')).toBe(3);
  });

  it('an axe grip held still is not a pinch', () => {
    const s = new Sim();
    s.calibrate();
    for (let i = 0; i < 20; i++) s.step(still(), [hand(0.5, 0.5, 0.1, 'axe')]);
    expect(s.count('place')).toBe(0);
  });

  it('a closed fist is not a pinch', () => {
    const s = new Sim();
    s.calibrate();
    for (let i = 0; i < 20; i++) s.step(still(), [hand(0.5, 0.5, 0.1, 'fist')]);
    expect(s.count('place')).toBe(0);
    expect(s.g.hands[0].pinched).toBe(false);
  });

  it('a pinch that closes mid-motion never places; a fresh still pinch does', () => {
    const s = new Sim();
    s.calibrate();
    let x = 0.3;
    for (let i = 0; i < 4; i++) s.step(still(), [hand(x, 0.5, 0.1)]);
    for (let i = 0; i < 3; i++) { x += 0.02; s.step(still(), [hand(x, 0.5, 0.1, 'pinch')]); } // moving ~6 sizes/s
    for (let i = 0; i < 8; i++) s.step(still(), [hand(x, 0.5, 0.1, 'pinch')]); // settles, still pinched
    expect(s.count('place')).toBe(0);
    for (let i = 0; i < 4; i++) s.step(still(), [hand(x, 0.5, 0.1, 'open')]); // release
    for (let i = 0; i < 4; i++) s.step(still(), [hand(x, 0.5, 0.1, 'pinch')]);
    expect(s.count('place')).toBe(1);
  });

  it('chopping never places, even if the grip looks like a pinch', () => {
    const s = new Sim();
    s.calibrate();
    for (let rep = 0; rep < 4; rep++) {
      let y = 0.3;
      for (let i = 0; i < 6; i++) s.step(still(), [hand(0.6, y, 0.1, 'axe')]);
      for (let i = 0; i < 5; i++) { y += 0.05; s.step(still(), [hand(0.6, y, 0.1, 'axe')]); }
      for (let i = 0; i < 4; i++) s.step(still(), [hand(0.6, y, 0.1, 'axe')]); // settle in the grip
      for (let i = 0; i < 12; i++) { y -= 0.02; s.step(still(), [hand(0.6, y, 0.1, 'axe')]); }
    }
    expect(s.count('hit')).toBe(4);
    expect(s.count('place')).toBe(0);
  });

  it('settling into a pinch grip right after a chop does not place', () => {
    const s = new Sim();
    s.calibrate();
    let y = 0.3;
    for (let i = 0; i < 6; i++) s.step(still(), [hand(0.6, y, 0.1, 'fist')]);
    for (let i = 0; i < 5; i++) { y += 0.05; s.step(still(), [hand(0.6, y, 0.1, 'fist')]); }
    for (let i = 0; i < 8; i++) s.step(still(), [hand(0.6, y, 0.1, 'pinch')]); // fingers meet as the arm stops
    expect(s.count('hit')).toBe(1);
    expect(s.count('place')).toBe(0);
  });

  it('tracks two hands independently', () => {
    const s = new Sim();
    s.calibrate();
    let y = 0.3;
    for (let i = 0; i < 6; i++) s.step(still(), [hand(0.25, 0.5, 0.1), hand(0.75, y, 0.1, 'fist')]);
    for (let i = 0; i < 5; i++) { y += 0.05; s.step(still(), [hand(0.25, 0.5, 0.1), hand(0.75, y, 0.1, 'fist')]); }
    expect(s.count('hit')).toBe(1);
    expect(s.g.hands.length).toBe(2);
  });

  it('a two-handed axe swing counts as one hit', () => {
    const s = new Sim();
    s.calibrate();
    let y = 0.3;
    for (let i = 0; i < 6; i++) s.step(still(), [hand(0.45, y, 0.1, 'fist'), hand(0.58, y + 0.02, 0.1, 'fist')]);
    for (let i = 0; i < 5; i++) {
      y += 0.05;
      s.step(still(), [hand(0.45, y, 0.1, 'fist'), hand(0.58, y + 0.02, 0.1, 'fist')]);
    }
    expect(s.count('hit')).toBe(1);
  });
});
