// Owns terrain generation and meshing so the render thread never stalls.
import { AIR, CH, CS, chunkKey, voxelIndex } from './blocks';
import { createGenerator } from './gen';
import { buildPadded, meshChunk, PX, PY, type MeshData } from './mesher';
import type { FromWorker, ToWorker } from './protocol';

let gen: ReturnType<typeof createGenerator> | null = null;
const data = new Map<number, Uint8Array>();
const edits = new Map<number, Map<number, number>>(); // chunk -> voxel index -> block
const sent = new Set<number>(); // chunks whose mesh + voxels the main thread holds
const dirty = new Set<number>(); // sent chunks that need a remesh
let queue: [number, number][] = [];
let centerX = 0, centerZ = 0, radius = 8;
const padded = new Uint8Array(PX * PX * PY);

const live = (cx: number, cz: number) => {
  const dx = cx - centerX, dz = cz - centerZ;
  return dx * dx + dz * dz <= (radius + 1) * (radius + 1);
};

function ensureData(cx: number, cz: number) {
  const k = chunkKey(cx, cz);
  let v = data.get(k);
  if (!v) {
    v = gen!.generate(cx, cz);
    const e = edits.get(k);
    if (e) for (const [i, id] of e) v[i] = id;
    data.set(k, v);
  }
  return v;
}

const getChunk = (cx: number, cz: number) => data.get(chunkKey(cx, cz));

function mesh(cx: number, cz: number) {
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) ensureData(cx + dx, cz + dz);
  buildPadded(padded, cx, cz, getChunk);
  return meshChunk(padded);
}

function transfer(m: MeshData | null, list: Transferable[]) {
  if (m) list.push(m.pos.buffer, m.uv.buffer, m.lt.buffer, m.idx.buffer);
}

function post(msg: FromWorker, t: Transferable[]) {
  (self as unknown as Worker).postMessage(msg, t);
}

function step(): boolean {
  if (dirty.size) {
    const k = dirty.values().next().value as number;
    dirty.delete(k);
    const cx = (k >>> 16) - 32768, cz = (k & 0xffff) - 32768;
    if (!sent.has(k)) return true;
    const m = mesh(cx, cz);
    const t: Transferable[] = [];
    transfer(m.opaque, t);
    transfer(m.water, t);
    post({ t: 'mesh', cx, cz, opaque: m.opaque, water: m.water }, t);
    return true;
  }
  while (queue.length) {
    const [cx, cz] = queue.shift()!;
    const k = chunkKey(cx, cz);
    if (sent.has(k) || !live(cx, cz)) continue;
    const m = mesh(cx, cz);
    const voxels = data.get(k)!.slice();
    const t: Transferable[] = [voxels.buffer];
    transfer(m.opaque, t);
    transfer(m.water, t);
    post({ t: 'chunk', cx, cz, voxels, opaque: m.opaque, water: m.water }, t);
    sent.add(k);
    return true;
  }
  return false;
}

// Yield between slices with a MessageChannel (setTimeout clamps to 4ms).
const channel = new MessageChannel();
let scheduled = false;
channel.port1.onmessage = () => {
  scheduled = false;
  const start = performance.now();
  while (performance.now() - start < 8) {
    if (!step()) return;
  }
  schedule();
};
function schedule() {
  if (scheduled) return;
  scheduled = true;
  channel.port2.postMessage(null);
}

function setCenter(cx: number, cz: number, r: number) {
  centerX = cx;
  centerZ = cz;
  radius = r;
  for (const k of sent) {
    const kx = (k >>> 16) - 32768, kz = (k & 0xffff) - 32768;
    if (!live(kx, kz)) sent.delete(k);
  }
  const keep = (radius + 3) * (radius + 3);
  for (const k of data.keys()) {
    const dx = (k >>> 16) - 32768 - cx, dz = (k & 0xffff) - 32768 - cz;
    if (dx * dx + dz * dz > keep) data.delete(k);
  }
  queue = [];
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dz * dz > radius * radius) continue;
      if (sent.has(chunkKey(cx + dx, cz + dz))) continue;
      queue.push([cx + dx, cz + dz]);
    }
  }
  queue.sort((a, b) => {
    const da = (a[0] - cx) ** 2 + (a[1] - cz) ** 2;
    const db = (b[0] - cx) ** 2 + (b[1] - cz) ** 2;
    return da - db;
  });
  schedule();
}

function setBlock(x: number, y: number, z: number, id: number) {
  if (y < 0 || y >= CH) return;
  const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
  const lx = x - cx * CS, lz = z - cz * CS;
  const k = chunkKey(cx, cz);
  const i = voxelIndex(lx, y, lz);
  let e = edits.get(k);
  if (!e) edits.set(k, (e = new Map()));
  e.set(i, id);
  const v = data.get(k);
  if (v) v[i] = id;
  // Remesh this chunk and any neighbour whose border (AO included) sees it.
  for (let dz = -1; dz <= 1; dz++) {
    if ((dz === -1 && lz !== 0) || (dz === 1 && lz !== CS - 1)) continue;
    for (let dx = -1; dx <= 1; dx++) {
      if ((dx === -1 && lx !== 0) || (dx === 1 && lx !== CS - 1)) continue;
      const nk = chunkKey(cx + dx, cz + dz);
      if (sent.has(nk)) dirty.add(nk);
    }
  }
  schedule();
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  switch (msg.t) {
    case 'init':
      gen = createGenerator(msg.seed);
      for (const [x, y, z, id] of msg.edits) {
        const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
        const k = chunkKey(cx, cz);
        let m = edits.get(k);
        if (!m) edits.set(k, (m = new Map()));
        m.set(voxelIndex(x - cx * CS, y, z - cz * CS), id);
      }
      break;
    case 'center':
      setCenter(msg.cx, msg.cz, msg.radius);
      break;
    case 'set':
      setBlock(msg.x, msg.y, msg.z, msg.id);
      break;
    case 'height': {
      const v = ensureData(Math.floor(msg.x / CS), Math.floor(msg.z / CS));
      const lx = msg.x - Math.floor(msg.x / CS) * CS, lz = msg.z - Math.floor(msg.z / CS) * CS;
      let y = CH - 1;
      while (y > 0 && v[voxelIndex(lx, y, lz)] === AIR) y--;
      post({ t: 'height', x: msg.x, z: msg.z, y }, []);
      break;
    }
  }
};
