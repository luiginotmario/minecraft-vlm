import * as THREE from 'three';
import { AIR, BEDROCK, CH, CS, chunkKey, voxelIndex } from './blocks';
import type { MeshData } from './mesher';
import type { FromWorker, ToWorker } from './protocol';

interface Chunk {
  cx: number;
  cz: number;
  voxels: Uint8Array;
  opaque: THREE.Mesh | null;
  water: THREE.Mesh | null;
}

const SAVE_KEY = 'mcvlm.world.v1';

interface SaveData {
  seed: number;
  edits: [number, number, number, number][];
}

function loadSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? (JSON.parse(raw) as SaveData) : null;
  } catch {
    return null;
  }
}

export class World {
  readonly seed: number;
  readonly group = new THREE.Group();
  private chunks = new Map<number, Chunk>();
  private worker: Worker;
  private inbox: FromWorker[] = [];
  private edits = new Map<string, [number, number, number, number]>();
  private centerX = Infinity;
  private centerZ = Infinity;
  private saveTimer = 0;
  radius: number;
  onChunk?: (cx: number, cz: number) => void;

  constructor(
    private opaqueMat: THREE.Material,
    private waterMat: THREE.Material,
    radius: number,
  ) {
    this.radius = radius;
    const save = loadSave();
    this.seed = save?.seed ?? Math.floor(Math.random() * 1e9);
    for (const e of save?.edits ?? []) this.edits.set(`${e[0]},${e[1]},${e[2]}`, e);
    this.worker = new Worker(new URL('./world.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => {
      // Edits jump the queue so a broken block disappears on the next frame.
      if (e.data.t === 'mesh') this.inbox.unshift(e.data);
      else this.inbox.push(e.data);
    };
    this.send({ t: 'init', seed: this.seed, edits: [...this.edits.values()] });
  }

  private send(msg: ToWorker) {
    this.worker.postMessage(msg);
  }

  get loadedCount() {
    return this.chunks.size;
  }

  isLoadedAt(x: number, z: number) {
    return this.chunks.has(chunkKey(Math.floor(x / CS), Math.floor(z / CS)));
  }

  private lastKey = -1;
  private lastChunk: Chunk | undefined;

  getBlock(x: number, y: number, z: number): number {
    if (y < 0) return BEDROCK;
    if (y >= CH) return AIR;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    const k = chunkKey(cx, cz);
    let c = this.lastChunk;
    if (k !== this.lastKey) {
      c = this.chunks.get(k);
      this.lastKey = k;
      this.lastChunk = c;
    }
    if (!c) return AIR;
    return c.voxels[voxelIndex(x - cx * CS, y, z - cz * CS)];
  }

  setBlock(x: number, y: number, z: number, id: number) {
    if (y < 0 || y >= CH) return;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    const c = this.chunks.get(chunkKey(cx, cz));
    if (!c) return;
    c.voxels[voxelIndex(x - cx * CS, y, z - cz * CS)] = id;
    this.edits.set(`${x},${y},${z}`, [x, y, z, id]);
    this.send({ t: 'set', x, y, z, id });
    this.scheduleSave();
  }

  /** Top non-air block in a loaded column, or -1. */
  surfaceY(x: number, z: number) {
    if (!this.isLoadedAt(x, z)) return -1;
    for (let y = CH - 1; y > 0; y--) if (this.getBlock(x, y, z) !== AIR) return y;
    return 0;
  }

  private scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      try {
        const data: SaveData = { seed: this.seed, edits: [...this.edits.values()] };
        localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      } catch {
        /* storage unavailable; edits stay in memory */
      }
    }, 800);
  }

  reset() {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      /* ignore */
    }
    location.reload();
  }

  private live(cx: number, cz: number) {
    const dx = cx - this.centerX, dz = cz - this.centerZ;
    return dx * dx + dz * dz <= (this.radius + 1) * (this.radius + 1);
  }

  /** Track the player; returns true when the centre chunk changed. */
  update(px: number, pz: number, force = false) {
    const cx = Math.floor(px / CS), cz = Math.floor(pz / CS);
    if (!force && cx === this.centerX && cz === this.centerZ) return false;
    this.centerX = cx;
    this.centerZ = cz;
    for (const [k, c] of this.chunks) {
      if (!this.live(c.cx, c.cz)) {
        this.disposeChunk(c);
        this.chunks.delete(k);
      }
    }
    this.lastKey = -1;
    this.send({ t: 'center', cx, cz, radius: this.radius });
    return true;
  }

  /** Apply worker results within a time budget so uploads never cause a hitch. */
  processInbox(budgetMs: number) {
    const start = performance.now();
    while (this.inbox.length && performance.now() - start < budgetMs) {
      const msg = this.inbox.shift()!;
      if (msg.t === 'height') continue;
      const k = chunkKey(msg.cx, msg.cz);
      if (msg.t === 'chunk') {
        if (!this.live(msg.cx, msg.cz)) continue;
        const old = this.chunks.get(k);
        if (old) this.disposeChunk(old);
        const c: Chunk = { cx: msg.cx, cz: msg.cz, voxels: msg.voxels, opaque: null, water: null };
        this.chunks.set(k, c);
        this.lastKey = -1;
        this.applyMeshes(c, msg.opaque, msg.water);
        this.onChunk?.(msg.cx, msg.cz);
      } else {
        const c = this.chunks.get(k);
        if (!c) continue;
        this.applyMeshes(c, msg.opaque, msg.water);
      }
    }
  }

  private applyMeshes(c: Chunk, opaque: MeshData | null, water: MeshData | null) {
    if (c.opaque) this.disposeMesh(c.opaque);
    if (c.water) this.disposeMesh(c.water);
    c.opaque = opaque ? this.makeMesh(c, opaque, this.opaqueMat) : null;
    c.water = water ? this.makeMesh(c, water, this.waterMat) : null;
  }

  private makeMesh(c: Chunk, m: MeshData, mat: THREE.Material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(m.uv, 2));
    g.setAttribute('lt', new THREE.BufferAttribute(m.lt, 2));
    g.setIndex(new THREE.BufferAttribute(m.idx, 1));
    // Bounds are known from the chunk, no need to scan vertices.
    g.boundingBox = new THREE.Box3(new THREE.Vector3(0, m.minY, 0), new THREE.Vector3(CS, m.maxY, CS));
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    const mesh = new THREE.Mesh(g, mat);
    mesh.position.set(c.cx * CS, 0, c.cz * CS);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
    return mesh;
  }

  private disposeMesh(m: THREE.Mesh) {
    this.group.remove(m);
    m.geometry.dispose();
  }

  private disposeChunk(c: Chunk) {
    if (c.opaque) this.disposeMesh(c.opaque);
    if (c.water) this.disposeMesh(c.water);
    c.opaque = c.water = null;
  }
}
