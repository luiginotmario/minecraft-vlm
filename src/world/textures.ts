import { T, TILE_COUNT } from './blocks';
import { mulberry32 } from './noise';

export const TILE = 16;

type RGB = [number, number, number];
type Px = (x: number, y: number) => [number, number, number, number];

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

/**
 * Generate every block texture procedurally as RGBA rows, top row first.
 * Returns one buffer holding TILE_COUNT tiles back to back.
 */
export function generateTiles(seed = 1337): Uint8Array {
  const out = new Uint8Array(TILE * TILE * 4 * TILE_COUNT);
  const rnd = mulberry32(seed);
  const r = () => rnd();
  const noise = new Float32Array(TILE * TILE);
  const reseed = () => {
    for (let i = 0; i < noise.length; i++) noise[i] = r();
  };
  const n = (x: number, y: number) => noise[(y & 15) * TILE + (x & 15)];

  const paint = (layer: number, fn: Px) => {
    reseed();
    const base = layer * TILE * TILE * 4;
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const [cr, cg, cb, ca] = fn(x, y);
        const i = base + (y * TILE + x) * 4;
        out[i] = clamp(cr);
        out[i + 1] = clamp(cg);
        out[i + 2] = clamp(cb);
        out[i + 3] = clamp(ca);
      }
    }
  };
  const vary = (c: RGB, amt: number, k: number): [number, number, number, number] => {
    const f = 1 + (k - 0.5) * amt;
    return [c[0] * f, c[1] * f, c[2] * f, 255];
  };

  const DIRT: RGB = [134, 96, 67];
  const GRASS: RGB = [104, 168, 66];
  const STONE: RGB = [128, 128, 130];
  const SNOW: RGB = [238, 244, 250];

  const dirt: Px = (x, y) => {
    const k = n(x, y);
    if (k > 0.9) return [96, 68, 46, 255];
    if (k < 0.08) return [158, 118, 86, 255];
    return vary(DIRT, 0.22, k);
  };
  const stone: Px = (x, y) => {
    const k = n(x, y);
    const streak = n(x + 3, y >> 1) > 0.85 ? 0.82 : 1;
    const c = vary(STONE, 0.18, k);
    return [c[0] * streak, c[1] * streak, c[2] * streak, 255];
  };

  paint(T.DIRT, dirt);
  paint(T.GRASS_TOP, (x, y) => vary(GRASS, 0.32, n(x, y) * 0.7 + n(x + 7, y + 3) * 0.3));
  // Grass side: dirt with an uneven fringe of grass on top.
  const fringe = Array.from({ length: TILE }, () => 2 + Math.floor(r() * 3));
  paint(T.GRASS_SIDE, (x, y) => (y < fringe[x] ? vary(GRASS, 0.3, n(x, y)) : dirt(x, y)));
  paint(T.STONE, stone);

  // Cobblestone: Voronoi cells separated by dark mortar.
  const pts = Array.from({ length: 9 }, () => [r() * TILE, r() * TILE, 0.75 + r() * 0.4]);
  paint(T.COBBLE, (x, y) => {
    let d1 = 1e9, d2 = 1e9, cell = 0;
    for (let i = 0; i < pts.length; i++) {
      for (let oy = -TILE; oy <= TILE; oy += TILE) {
        for (let ox = -TILE; ox <= TILE; ox += TILE) {
          const dx = x + 0.5 - (pts[i][0] + ox);
          const dy = y + 0.5 - (pts[i][1] + oy);
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < d1) { d2 = d1; d1 = d; cell = i; } else if (d < d2) d2 = d;
        }
      }
    }
    if (d2 - d1 < 1.1) return vary([74, 74, 76], 0.2, n(x, y));
    const shade = pts[cell][2] * (1 + (d2 - d1) * 0.015);
    return vary([118 * shade, 118 * shade, 121 * shade], 0.2, n(x, y));
  });

  const WOOD: RGB = [168, 135, 82];
  paint(T.PLANKS, (x, y) => {
    const board = y >> 2;
    if ((y & 3) === 3) return [104, 80, 46, 255];
    const seam = (board & 1 ? 4 : 11) === x;
    if (seam) return [120, 92, 54, 255];
    const grain = n(x >> 1, y) * 0.6 + n(x, board) * 0.4;
    return vary([WOOD[0] - board * 3, WOOD[1] - board * 2, WOOD[2]], 0.2, grain);
  });

  const BARK: RGB = [104, 82, 50];
  paint(T.LOG_SIDE, (x, y) => {
    const stripe = n(x, 0) * 0.5 + n(x, y >> 2) * 0.5;
    if (stripe > 0.78) return [70, 54, 32, 255];
    return vary(BARK, 0.3, stripe);
  });
  paint(T.LOG_TOP, (x, y) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) return vary(BARK, 0.25, n(x, y));
    const dx = x - 7.5, dy = y - 7.5;
    const ring = Math.sqrt(dx * dx + dy * dy);
    const band = Math.floor(ring) % 3 === 0;
    return vary(band ? [150, 116, 70] : [184, 150, 96], 0.12, n(x, y));
  });

  paint(T.LEAVES, (x, y) => {
    const k = n(x, y);
    if (k < 0.16) return [0, 0, 0, 0];
    return vary([58, 128, 40], 0.45, n(x + 5, y + 2));
  });

  paint(T.GLASS, (x, y) => {
    const edge = x === 0 || y === 0 || x === 15 || y === 15;
    if (edge) return [214, 236, 244, 255];
    const glint = (x === y + 3 && x > 4 && x < 11) || (x === y + 5 && x > 7 && x < 12);
    if (glint) return [240, 250, 255, 255];
    return [0, 0, 0, 0];
  });

  paint(T.BRICK, (x, y) => {
    const row = y >> 2;
    const off = row & 1 ? 4 : 0;
    if ((y & 3) === 3 || ((x + off) & 7) === 7) return vary([182, 172, 160], 0.1, n(x, y));
    return vary([152, 72, 56], 0.24, n(x, y));
  });

  paint(T.SAND, (x, y) => vary([220, 206, 158], 0.12, n(x, y)));
  paint(T.WATER, (x, y) => vary([52, 104, 210], 0.14, n(x, y) * 0.5 + n(x + 3, y + 1) * 0.5));

  const ore = (fleck: RGB, light: RGB) => {
    const spots = new Uint8Array(TILE * TILE);
    for (let c = 0; c < 5; c++) {
      const cx = 2 + Math.floor(r() * 12), cy = 2 + Math.floor(r() * 12);
      for (let k = 0; k < 4; k++) spots[(cy + (k >> 1)) * TILE + cx + (k & 1)] = r() > 0.25 ? 1 + (k & 1) : 0;
    }
    return (x: number, y: number): [number, number, number, number] => {
      const s = spots[y * TILE + x];
      if (s === 1) return vary(fleck, 0.15, n(x, y));
      if (s === 2) return vary(light, 0.15, n(x, y));
      return stone(x, y);
    };
  };
  paint(T.COAL, ore([34, 34, 36], [60, 60, 64]));
  paint(T.IRON, ore([196, 150, 118], [226, 190, 160]));

  paint(T.BEDROCK, (x, y) => {
    const k = n(x, y);
    const v = k > 0.6 ? 110 : k > 0.3 ? 70 : 40;
    return [v, v, v + 2, 255];
  });
  paint(T.SNOW, (x, y) => vary(SNOW, 0.06, n(x, y)));
  paint(T.SNOW_SIDE, (x, y) => (y < fringe[x] + 1 ? vary(SNOW, 0.06, n(x, y)) : dirt(x, y)));

  return out;
}

/** Average colour of a tile (opaque pixels only), for particles. */
export function tileAverage(tiles: Uint8Array, layer: number): RGB {
  let r = 0, g = 0, b = 0, c = 0;
  const base = layer * TILE * TILE * 4;
  for (let i = 0; i < TILE * TILE; i++) {
    if (tiles[base + i * 4 + 3] < 128) continue;
    r += tiles[base + i * 4];
    g += tiles[base + i * 4 + 1];
    b += tiles[base + i * 4 + 2];
    c++;
  }
  return c ? [r / c, g / c, b / c] : [255, 255, 255];
}

/** Draw a tile into a 2D canvas at (dx, dy). */
export function tileImage(tiles: Uint8Array, layer: number): ImageData {
  const img = new ImageData(TILE, TILE);
  img.data.set(tiles.subarray(layer * TILE * TILE * 4, (layer + 1) * TILE * TILE * 4));
  return img;
}
