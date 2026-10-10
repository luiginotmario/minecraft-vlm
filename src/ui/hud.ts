import { BLOCKS, HOTBAR } from '../world/blocks';
import { TILE, tileImage } from '../world/textures';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Isometric block icon drawn from the procedural tiles. */
function blockIcon(tiles: Uint8Array, id: number): HTMLCanvasElement {
  const S = 48;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  const tile = (layer: number) => {
    const t = document.createElement('canvas');
    t.width = TILE;
    t.height = TILE;
    t.getContext('2d')!.putImageData(tileImage(tiles, layer), 0, 0);
    return t;
  };
  const [top, , side] = BLOCKS[id].tex;
  const k = 20 / 16, h = 10 / 16;
  const face = (img: HTMLCanvasElement, a: number, b: number, cc: number, d: number, e: number, f: number, shade: number) => {
    g.setTransform(a, b, cc, d, e, f);
    g.drawImage(img, 0, 0);
    if (shade > 0) {
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = `rgba(0,0,0,${shade})`;
      g.fillRect(0, 0, TILE, TILE);
      g.globalCompositeOperation = 'source-over';
    }
  };
  face(tile(top), k, -h, k, h, 4, 14, 0);
  face(tile(side), k, h, 0, k, 4, 14, 0.22);
  face(tile(side), k, -h, 0, k, 24, 24, 0.38);
  g.setTransform(1, 0, 0, 1, 0, 0);
  return c;
}

export class Hud {
  private slots: HTMLElement[] = [];
  private gestureEl = $('gesture');
  private nameEl = $('blockname');
  private statsEl = $('stats');
  private statusEl = $('status');
  private gestureTimer = 0;
  private nameTimer = 0;

  constructor(tiles: Uint8Array) {
    const bar = $('hotbar');
    HOTBAR.forEach((id, i) => {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.appendChild(blockIcon(tiles, id));
      const n = document.createElement('span');
      n.textContent = String(i + 1);
      slot.appendChild(n);
      bar.appendChild(slot);
      this.slots.push(slot);
    });
  }

  select(i: number) {
    this.slots.forEach((s, j) => s.classList.toggle('active', i === j));
    this.nameEl.textContent = BLOCKS[HOTBAR[i]].name;
    this.flash(this.nameEl, 'nameTimer', 1200);
  }

  /** Brief label confirming what the camera saw. */
  gesture(label: string) {
    this.gestureEl.textContent = label;
    this.flash(this.gestureEl, 'gestureTimer', 450);
  }

  private flash(el: HTMLElement, timer: 'gestureTimer' | 'nameTimer', ms: number) {
    el.classList.add('show');
    clearTimeout(this[timer]);
    this[timer] = window.setTimeout(() => el.classList.remove('show'), ms);
  }

  stats(text: string) {
    if (this.statsEl.textContent !== text) this.statsEl.textContent = text;
  }

  status(text: string) {
    if (this.statusEl.textContent !== text) this.statusEl.textContent = text;
  }
}
