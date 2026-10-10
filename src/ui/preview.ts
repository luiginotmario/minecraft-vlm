import type { GestureEngine } from '../vision/gestures';
import type { VisionFrame } from '../vision/protocol';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

/** Picture-in-picture camera view with landmarks and the head joystick. */
export class Preview {
  readonly root = $('pip');
  private overlay = $<HTMLCanvasElement>('pip-overlay');
  private stick = $<HTMLCanvasElement>('pip-stick');
  private moveEl = $('pip-move');
  private handsEl = $('pip-hands');
  private rateEl = $('pip-rate');
  private og = this.overlay.getContext('2d')!;
  private sg = this.stick.getContext('2d')!;

  constructor() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of [this.overlay, this.stick]) {
      const w = c.width, h = c.height;
      c.width = w * dpr;
      c.height = h * dpr;
      c.getContext('2d')!.scale(dpr, dpr);
    }
  }

  set visible(v: boolean) {
    this.root.hidden = !v;
  }

  draw(frame: VisionFrame, g: GestureEngine, range: number, deadzone: number, stats: string) {
    if (this.root.hidden) return;
    const W = 240, H = 180;
    const ctx = this.og;
    ctx.clearRect(0, 0, W, H);
    // The video is shown mirrored with object-fit: cover, so map coordinates the same way.
    const ar = frame.w / frame.h;
    const viewAr = W / H;
    const sx = ar > viewAr ? (H * ar) : W;
    const sy = ar > viewAr ? H : W / ar;
    const ox = (W - sx) / 2, oy = (H - sy) / 2;
    const px = (x: number) => ox + (1 - x) * sx;
    const py = (y: number) => oy + y * sy;

    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    frame.hands.forEach((h, i) => {
      const view = g.hands[i];
      ctx.strokeStyle = view?.pinched ? '#ffd166' : '#8fd26b';
      ctx.beginPath();
      for (const [a, b] of BONES) {
        ctx.moveTo(px(h.lm[a * 3]), py(h.lm[a * 3 + 1]));
        ctx.lineTo(px(h.lm[b * 3]), py(h.lm[b * 3 + 1]));
      }
      ctx.stroke();
    });
    if (frame.face) {
      ctx.fillStyle = '#7cc4ff';
      for (let i = 0; i < frame.face.length / 3; i++) {
        ctx.beginPath();
        ctx.arc(px(frame.face[i * 3]), py(frame.face[i * 3 + 1]), 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    this.drawStick(g, range, deadzone);

    const move = g.jog === 2 ? 'Sprinting' : g.jog === 1 ? 'Walking' : g.lean === 1 ? 'Leaning in' : 'Still';
    this.moveEl.textContent = g.calibrating ? 'Hold still…' : move;
    this.moveEl.classList.toggle('on', g.jog > 0 || g.lean !== 0);
    const hands = g.hands.length;
    this.handsEl.textContent = g.mineHold ? 'Pinch: mining' : hands ? `${hands} hand${hands > 1 ? 's' : ''}` : 'No hands';
    this.handsEl.classList.toggle('on', g.mineHold);
    if (this.rateEl.textContent !== stats) this.rateEl.textContent = stats;
  }

  private drawStick(g: GestureEngine, range: number, deadzone: number) {
    const ctx = this.sg;
    const S = 64, C = S / 2, R = 28;
    ctx.clearRect(0, 0, S, S);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(C, C, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.arc(C, C, (deadzone / range) * R, 0, Math.PI * 2);
    ctx.fill();
    if (!g.faceVisible) return;
    const nx = Math.max(-1.2, Math.min(1.2, g.yaw / range));
    const ny = Math.max(-1.2, Math.min(1.2, g.pitch / range));
    ctx.fillStyle = Math.hypot(g.yaw, g.pitch) > deadzone ? '#8fd26b' : '#ffffff';
    ctx.beginPath();
    ctx.arc(C + nx * R, C - ny * R, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
}
