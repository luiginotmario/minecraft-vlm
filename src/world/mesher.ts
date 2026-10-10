import { AIR, BLOCKS, CH, CS, IS_OPAQUE, WATER } from './blocks';

// Padded volume: one block of border on every side so AO and face culling can
// read neighbours without branching on chunk edges.
export const PX = CS + 2;
export const PY = CH + 2;
export const pIndex = (x: number, y: number, z: number) => ((y + 1) * PX + (z + 1)) * PX + (x + 1);

export interface MeshData {
  pos: Float32Array;
  uv: Float32Array;
  /** Per vertex: texture layer, light. */
  lt: Float32Array;
  idx: Uint16Array | Uint32Array;
  minY: number;
  maxY: number;
}

export interface ChunkMesh {
  opaque: MeshData | null;
  water: MeshData | null;
}

/**
 * Fill `out` with the chunk plus a one-block border. `get(cx, cz)` returns the
 * voxel array of a chunk or undefined if it isn't generated.
 */
export function buildPadded(
  out: Uint8Array,
  cx: number,
  cz: number,
  get: (cx: number, cz: number) => Uint8Array | undefined,
) {
  out.fill(AIR);
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const src = get(cx + dx, cz + dz);
      if (!src) continue;
      const x0 = dx === -1 ? CS - 1 : 0;
      const x1 = dx === 1 ? 0 : CS - 1;
      const z0 = dz === -1 ? CS - 1 : 0;
      const z1 = dz === 1 ? 0 : CS - 1;
      for (let y = 0; y < CH; y++) {
        for (let z = z0; z <= z1; z++) {
          const lz = z + dz * CS;
          const srcRow = (y * CS + z) * CS;
          const dstRow = ((y + 1) * PX + (lz + 1)) * PX + 1 + dx * CS;
          for (let x = x0; x <= x1; x++) out[dstRow + x] = src[srcRow + x];
        }
      }
    }
  }
}

// Growable vertex builder reused across meshing calls.
class Builder {
  pos = new Float32Array(1 << 16);
  uv = new Float32Array(1 << 16);
  lt = new Float32Array(1 << 16);
  idx = new Uint32Array(1 << 16);
  nv = 0;
  ni = 0;
  minY = Infinity;
  maxY = -Infinity;

  reset() {
    this.nv = 0;
    this.ni = 0;
    this.minY = Infinity;
    this.maxY = -Infinity;
  }

  private grow() {
    const g = <A extends Float32Array | Uint32Array>(a: A, n: number): A => {
      if (a.length >= n) return a;
      const b = new (a.constructor as { new (n: number): A })(Math.max(n, a.length * 2));
      b.set(a);
      return b;
    };
    this.pos = g(this.pos, (this.nv + 4) * 3);
    this.uv = g(this.uv, (this.nv + 4) * 2);
    this.lt = g(this.lt, (this.nv + 4) * 2);
    this.idx = g(this.idx, this.ni + 6);
  }

  vertex(x: number, y: number, z: number, s: number, t: number, layer: number, light: number) {
    const v = this.nv++;
    this.pos[v * 3] = x;
    this.pos[v * 3 + 1] = y;
    this.pos[v * 3 + 2] = z;
    this.uv[v * 2] = s;
    this.uv[v * 2 + 1] = t;
    this.lt[v * 2] = layer;
    this.lt[v * 2 + 1] = light;
    if (y < this.minY) this.minY = y;
    if (y > this.maxY) this.maxY = y;
  }

  quadIndices(pattern: readonly number[]) {
    const base = this.nv;
    for (let i = 0; i < 6; i++) this.idx[this.ni++] = base + pattern[i];
  }

  ensure() {
    if (this.pos.length < (this.nv + 4) * 3 || this.idx.length < this.ni + 6) this.grow();
  }

  take(): MeshData | null {
    if (this.nv === 0) return null;
    const idx = this.nv <= 65535 ? Uint16Array.from(this.idx.subarray(0, this.ni)) : this.idx.slice(0, this.ni);
    return {
      pos: this.pos.slice(0, this.nv * 3),
      uv: this.uv.slice(0, this.nv * 2),
      lt: this.lt.slice(0, this.nv * 2),
      idx,
      minY: this.minY,
      maxY: this.maxY,
    };
  }
}

const opaqueB = new Builder();
const waterB = new Builder();

// Face brightness by axis and direction: [-x,+x], [-y,+y], [-z,+z].
const SHADE = [
  [0.78, 0.78],
  [0.5, 1.0],
  [0.64, 0.64],
];
const AO_CURVE = [0.42, 0.62, 0.8, 1.0];

// Index patterns: positive faces wind p0..p3 CCW, negative faces reverse.
const IDX_POS = [0, 1, 2, 0, 2, 3];
const IDX_POS_FLIP = [1, 2, 3, 1, 3, 0];
const IDX_NEG = [0, 2, 1, 0, 3, 2];
const IDX_NEG_FLIP = [1, 3, 2, 1, 0, 3];

const DIMS = [CS, CH, CS];
const mask = new Int32Array(CH * CS);
const maskAo = new Uint8Array(CH * CS * 4);
const x = [0, 0, 0];
const q = [0, 0, 0];
const STRIDE = [1, PX * PX, PX]; // padded index strides for x, y, z

/** Does a face of block `id` show against neighbour `nb`? */
function faceVisible(id: number, nb: number) {
  if (nb === AIR) return true;
  if (IS_OPAQUE[nb]) return false;
  return nb !== id;
}

export function meshChunk(vol: Uint8Array): ChunkMesh {
  opaqueB.reset();
  waterB.reset();

  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3;
    const v = (d + 2) % 3;
    const du = DIMS[u];
    const dv = DIMS[v];
    const sd = STRIDE[d], su = STRIDE[u], sv = STRIDE[v];

    for (let dir = -1; dir <= 1; dir += 2) {
      const shade = SHADE[d][dir > 0 ? 1 : 0];
      const texSlot = d === 1 ? (dir > 0 ? 0 : 1) : 2;

      for (let i = 0; i < DIMS[d]; i++) {
        x[d] = i;
        // Build the face mask for this slice.
        let any = false;
        for (let b = 0; b < dv; b++) {
          x[v] = b;
          for (let a = 0; a < du; a++) {
            x[u] = a;
            const m = b * du + a;
            const pi = pIndex(x[0], x[1], x[2]);
            const id = vol[pi];
            mask[m] = 0;
            if (id === AIR || id === WATER) continue;
            const ni = pi + dir * sd;
            if (!faceVisible(id, vol[ni])) continue;
            // Ambient occlusion from the layer in front of the face.
            const s0 = IS_OPAQUE[vol[ni - su]], s1 = IS_OPAQUE[vol[ni + su]];
            const t0 = IS_OPAQUE[vol[ni - sv]], t1 = IS_OPAQUE[vol[ni + sv]];
            const c00 = IS_OPAQUE[vol[ni - su - sv]], c10 = IS_OPAQUE[vol[ni + su - sv]];
            const c11 = IS_OPAQUE[vol[ni + su + sv]], c01 = IS_OPAQUE[vol[ni - su + sv]];
            const a0 = s0 && t0 ? 0 : 3 - (s0 + t0 + c00);
            const a1 = s1 && t0 ? 0 : 3 - (s1 + t0 + c10);
            const a2 = s1 && t1 ? 0 : 3 - (s1 + t1 + c11);
            const a3 = s0 && t1 ? 0 : 3 - (s0 + t1 + c01);
            maskAo[m * 4] = a0;
            maskAo[m * 4 + 1] = a1;
            maskAo[m * 4 + 2] = a2;
            maskAo[m * 4 + 3] = a3;
            const uniform = a0 === a1 && a1 === a2 && a2 === a3;
            const layer = BLOCKS[id].tex[texSlot];
            // Non-uniform AO cells get a negative key so they never merge.
            mask[m] = uniform ? ((layer + 1) | (a0 << 8)) : -1;
            any = true;
          }
        }
        if (!any) continue;

        // Greedy merge.
        for (let b = 0; b < dv; b++) {
          for (let a = 0; a < du; ) {
            const m = b * du + a;
            const key = mask[m];
            if (key === 0) {
              a++;
              continue;
            }
            let w = 1;
            let h = 1;
            if (key > 0) {
              while (a + w < du && mask[m + w] === key) w++;
              outer: while (b + h < dv) {
                const row = (b + h) * du + a;
                for (let k = 0; k < w; k++) if (mask[row + k] !== key) break outer;
                h++;
              }
            }
            // Recover the block for its layer (non-uniform cells have key -1).
            x[u] = a;
            x[v] = b;
            const id = vol[pIndex(x[0], x[1], x[2])];
            const layer = BLOCKS[id].tex[texSlot];
            const ao0 = maskAo[m * 4], ao1 = maskAo[m * 4 + 1], ao2 = maskAo[m * 4 + 2], ao3 = maskAo[m * 4 + 3];

            q[d] = dir > 0 ? i + 1 : i;
            q[u] = a;
            q[v] = b;
            opaqueB.ensure();
            const flip = ao0 + ao2 < ao1 + ao3;
            opaqueB.quadIndices(dir > 0 ? (flip ? IDX_POS_FLIP : IDX_POS) : flip ? IDX_NEG_FLIP : IDX_NEG);
            emit(opaqueB, d, u, v, w, h, layer, shade, ao0, ao1, ao2, ao3);

            for (let hb = 0; hb < h; hb++) for (let k = 0; k < w; k++) mask[(b + hb) * du + a + k] = 0;
            a += w;
          }
        }
      }
    }
  }

  meshWater(vol);
  return { opaque: opaqueB.take(), water: waterB.take() };
}

function emit(
  B: Builder, d: number, u: number, v: number, w: number, h: number,
  layer: number, shade: number, a0: number, a1: number, a2: number, a3: number,
) {
  const ox = q[0], oy = q[1], oz = q[2];
  AO4[0] = a0; AO4[1] = a1; AO4[2] = a2; AO4[3] = a3;
  for (let c = 0; c < 4; c++) {
    let px = ox, py = oy, pz = oz;
    const cu = c === 1 || c === 2 ? w : 0;
    const cv = c >= 2 ? h : 0;
    if (u === 0) px += cu; else if (u === 1) py += cu; else pz += cu;
    if (v === 0) px += cv; else if (v === 1) py += cv; else pz += cv;
    // Texture axes: side faces use world y for t so textures stay upright.
    let s: number, t: number;
    if (d === 0) { s = pz; t = py; }
    else if (d === 1) { s = px; t = pz; }
    else { s = px; t = py; }
    B.vertex(px, py, pz, s, t, layer, shade * AO_CURVE[AO4[c]]);
  }
}

const AO4 = [3, 3, 3, 3];
const WATER_TOP = 0.875;

function meshWater(vol: Uint8Array) {
  const layer = BLOCKS[WATER].tex[0];
  for (let y = 0; y < CH; y++) {
    for (let z = 0; z < CS; z++) {
      for (let xx = 0; xx < CS; xx++) {
        const pi = pIndex(xx, y, z);
        if (vol[pi] !== WATER) continue;
        const surface = vol[pi + STRIDE[1]] !== WATER;
        for (let d = 0; d < 3; d++) {
          const u = (d + 1) % 3;
          const v = (d + 2) % 3;
          for (let dir = -1; dir <= 1; dir += 2) {
            const nb = vol[pi + dir * STRIDE[d]];
            if (nb === WATER || IS_OPAQUE[nb]) continue;
            q[0] = xx; q[1] = y; q[2] = z;
            q[d] += dir > 0 ? 1 : 0;
            if (d === 1 && dir > 0 && surface) q[1] = y + WATER_TOP;
            waterB.ensure();
            waterB.quadIndices(dir > 0 ? IDX_POS : IDX_NEG);
            const base = waterB.nv;
            emit(waterB, d, u, v, 1, 1, layer, SHADE[d][dir > 0 ? 1 : 0], 3, 3, 3, 3);
            if (surface && d !== 1) {
              // Lower the top edge of side faces to the surface height.
              for (let k = base; k < waterB.nv; k++) {
                if (waterB.pos[k * 3 + 1] > y + 0.5) waterB.pos[k * 3 + 1] = y + WATER_TOP;
              }
            }
          }
        }
      }
    }
  }
}
