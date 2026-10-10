import {
  AIR, BEDROCK, CH, COAL, CS, DIRT, GRASS, IRON, LEAVES, LOG, SAND, SEA, SNOW, STONE, WATER, voxelIndex,
} from './blocks';
import { hash3, makeNoise, type Noise } from './noise';

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function fbm2(n: Noise, x: number, z: number, octaves: number) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * n.n2(x * freq, z * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

// Coarse cave grid: noise sampled every 4 blocks and trilinearly interpolated.
const CG = 4;
const GX = CS / CG + 1;
const GY = CH / CG + 1;

export function createGenerator(seed: number) {
  const nCont = makeNoise(seed);
  const nHill = makeNoise(seed + 1);
  const nMask = makeNoise(seed + 2);
  const nRidge = makeNoise(seed + 3);
  const nCaveA = makeNoise(seed + 4);
  const nCaveB = makeNoise(seed + 5);
  const nForest = makeNoise(seed + 6);
  const nDetail = makeNoise(seed + 7);

  function heightAt(x: number, z: number) {
    let h = SEA + 3 + fbm2(nCont, x / 320, z / 320, 4) * 24;
    h += fbm2(nHill, x / 96, z / 96, 3) * 9;
    const mask = smoothstep(0.02, 0.42, fbm2(nMask, x / 520 + 31.7, z / 520 - 12.3, 2));
    if (mask > 0) {
      const r = 1 - Math.abs(fbm2(nRidge, x / 170, z / 170, 4));
      h += mask * r * r * 58;
    }
    h += nDetail.n2(x / 18, z / 18) * 1.5;
    return Math.max(4, Math.min(CH - 14, Math.floor(h)));
  }

  const snowLine = (x: number, z: number) => 80 + nDetail.n2(x / 40, z / 40) * 5;

  function treeAt(x: number, z: number, h: number) {
    if (h <= SEA + 1 || h >= snowLine(x, z) - 6) return 0;
    const density = 0.002 + 0.04 * smoothstep(0.05, 0.45, fbm2(nForest, x / 140, z / 140, 2));
    const r = hash3(x, 0, z, seed);
    if (r >= density) return 0;
    return 4 + Math.floor(hash3(x, 1, z, seed) * 3); // trunk height
  }

  const caveGrid = new Float32Array(GX * GX * GY);
  const heights = new Int32Array((CS + 4) * (CS + 4));

  function generate(cx: number, cz: number): Uint8Array {
    const v = new Uint8Array(CS * CS * CH);
    const ox = cx * CS;
    const oz = cz * CS;

    // Heights for the chunk plus a 2-block margin (trees reach across borders).
    for (let z = -2; z < CS + 2; z++) {
      for (let x = -2; x < CS + 2; x++) {
        heights[(z + 2) * (CS + 4) + (x + 2)] = heightAt(ox + x, oz + z);
      }
    }

    // Spaghetti caves: carve where two noise fields are both near zero.
    for (let gy = 0; gy < GY; gy++) {
      for (let gz = 0; gz < GX; gz++) {
        for (let gx = 0; gx < GX; gx++) {
          const wx = (ox + gx * CG) / 38;
          const wy = (gy * CG) / 22;
          const wz = (oz + gz * CG) / 38;
          const a = nCaveA.n3(wx, wy, wz);
          const b = nCaveB.n3(wx, wy, wz);
          caveGrid[(gy * GX + gz) * GX + gx] = a * a + b * b;
        }
      }
    }
    const caveAt = (x: number, y: number, z: number) => {
      const fx = x / CG, fy = y / CG, fz = z / CG;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz);
      const tx = fx - x0, ty = fy - y0, tz = fz - z0;
      const i = (y0 * GX + z0) * GX + x0;
      const c000 = caveGrid[i], c100 = caveGrid[i + 1];
      const c010 = caveGrid[i + GX * GX], c110 = caveGrid[i + GX * GX + 1];
      const c001 = caveGrid[i + GX], c101 = caveGrid[i + GX + 1];
      const c011 = caveGrid[i + GX * GX + GX], c111 = caveGrid[i + GX * GX + GX + 1];
      const c00 = c000 + (c100 - c000) * tx;
      const c01 = c001 + (c101 - c001) * tx;
      const c10 = c010 + (c110 - c010) * tx;
      const c11 = c011 + (c111 - c011) * tx;
      const c0 = c00 + (c01 - c00) * tz;
      const c1 = c10 + (c11 - c10) * tz;
      return c0 + (c1 - c0) * ty;
    };

    for (let z = 0; z < CS; z++) {
      for (let x = 0; x < CS; x++) {
        const wx = ox + x;
        const wz = oz + z;
        const h = heights[(z + 2) * (CS + 4) + (x + 2)];
        const beach = h <= SEA + 1;
        const snowy = h >= snowLine(wx, wz);
        const dirtDepth = 3 + Math.floor(hash3(wx, 7, wz, seed) * 2);
        const top = beach ? SAND : snowy ? SNOW : GRASS;
        const under = beach ? SAND : DIRT;
        for (let y = 0; y <= h; y++) {
          let id: number;
          if (y === 0) id = BEDROCK;
          else if (y === h) id = top;
          else if (y > h - dirtDepth) id = under;
          else id = STONE;
          if (y > 2 && y < h - 1 + (h > SEA + 4 ? 2 : 0) && caveAt(x, y, z) < 0.012) id = AIR;
          if (id === STONE) {
            const r = hash3(wx, y, wz, seed + 11);
            if (y < 72 && r < 0.012) id = COAL;
            else if (y < 50 && r > 0.994) id = IRON;
          }
          v[voxelIndex(x, y, z)] = id;
        }
        for (let y = h + 1; y <= SEA; y++) v[voxelIndex(x, y, z)] = WATER;
      }
    }

    // Trees, including ones rooted in neighbouring chunks that overhang this one.
    for (let tz = -2; tz < CS + 2; tz++) {
      for (let tx = -2; tx < CS + 2; tx++) {
        const h = heights[(tz + 2) * (CS + 4) + (tx + 2)];
        const trunk = treeAt(ox + tx, oz + tz, h);
        if (!trunk) continue;
        const base = h + 1;
        const topY = base + trunk;
        const put = (x: number, y: number, z: number, id: number, replace: boolean) => {
          if (x < 0 || x >= CS || z < 0 || z >= CS || y < 0 || y >= CH) return;
          const i = voxelIndex(x, y, z);
          if (replace || v[i] === AIR) v[i] = id;
        };
        for (let y = topY - 3; y <= topY; y++) {
          const r = y >= topY - 1 ? 1 : 2;
          for (let dz = -r; dz <= r; dz++) {
            for (let dx = -r; dx <= r; dx++) {
              const corner = Math.abs(dx) === r && Math.abs(dz) === r;
              if (corner && (r === 1 ? y === topY : hash3(ox + tx + dx, y, oz + tz + dz, seed + 3) < 0.5)) continue;
              put(tx + dx, y, tz + dz, LEAVES, false);
            }
          }
        }
        for (let y = base; y < topY; y++) put(tx, y, tz, LOG, true);
        if (tx >= 0 && tx < CS && tz >= 0 && tz < CS) put(tx, h, tz, DIRT, true);
      }
    }
    return v;
  }

  return { generate, heightAt };
}
