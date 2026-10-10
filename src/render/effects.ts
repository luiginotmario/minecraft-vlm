import * as THREE from 'three';
import { mulberry32 } from '../world/noise';

const STAGES = 8;

/** Wireframe around the targeted block plus a crack overlay that grows with damage. */
export class BlockHighlight {
  readonly group = new THREE.Group();
  private crack: THREE.Mesh;
  private crackTex: THREE.CanvasTexture;

  constructor() {
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004));
    const lines = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 }),
    );
    lines.position.set(0.5, 0.5, 0.5);
    this.group.add(lines);

    this.crackTex = new THREE.CanvasTexture(drawCracks());
    this.crackTex.magFilter = THREE.NearestFilter;
    this.crackTex.minFilter = THREE.NearestFilter;
    this.crackTex.colorSpace = THREE.NoColorSpace;
    this.crackTex.repeat.set(1 / STAGES, 1);
    this.crack = new THREE.Mesh(
      new THREE.BoxGeometry(1.002, 1.002, 1.002),
      new THREE.MeshBasicMaterial({
        map: this.crackTex,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    );
    this.crack.position.set(0.5, 0.5, 0.5);
    this.crack.visible = false;
    this.group.add(this.crack);
    this.group.visible = false;
  }

  set(x: number, y: number, z: number) {
    this.group.position.set(x, y, z);
    this.group.visible = true;
  }

  hide() {
    this.group.visible = false;
  }

  /** 0 hides the overlay; (0, 1] picks a crack stage. */
  damage(f: number) {
    if (f <= 0) {
      this.crack.visible = false;
      return;
    }
    this.crack.visible = true;
    const stage = Math.min(STAGES - 1, Math.floor(f * STAGES));
    this.crackTex.offset.x = stage / STAGES;
  }
}

function drawCracks() {
  const S = 16;
  const c = document.createElement('canvas');
  c.width = S * STAGES;
  c.height = S;
  const g = c.getContext('2d')!;
  const rand = mulberry32(99);
  // One set of crack walks; each stage reveals more of them.
  const walks: [number, number][][] = [];
  for (let w = 0; w < 10; w++) {
    let x = 8 + (rand() - 0.5) * 4, y = 8 + (rand() - 0.5) * 4;
    const pts: [number, number][] = [];
    const ang = rand() * Math.PI * 2;
    for (let i = 0; i < 9; i++) {
      pts.push([Math.floor(x), Math.floor(y)]);
      x += Math.cos(ang + (rand() - 0.5) * 1.6);
      y += Math.sin(ang + (rand() - 0.5) * 1.6);
    }
    walks.push(pts);
  }
  for (let s = 0; s < STAGES; s++) {
    g.fillStyle = 'rgba(0,0,0,0.78)';
    const n = Math.ceil(((s + 1) / STAGES) * walks.length);
    const len = Math.ceil(3 + ((s + 1) / STAGES) * 6);
    for (let w = 0; w < n; w++) {
      for (const [px, py] of walks[w].slice(0, len)) {
        if (px >= 0 && px < S && py >= 0 && py < S) g.fillRect(s * S + px, py, 1, 1);
      }
    }
  }
  return c;
}

const MAX_PARTICLES = 384;

/** Pooled square debris particles with gravity. */
export class Particles {
  readonly points: THREE.Points;
  private pos = new Float32Array(MAX_PARTICLES * 3);
  private col = new Float32Array(MAX_PARTICLES * 3);
  private vel = new Float32Array(MAX_PARTICLES * 3);
  private life = new Float32Array(MAX_PARTICLES);
  private next = 0;
  private geo = new THREE.BufferGeometry();

  constructor() {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      vertexColors: true,
      uniforms: { scale: { value: 600 } },
      vertexShader: /* glsl */ `
        uniform float scale;
        varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = scale * 0.09 / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main() { gl_FragColor = vec4(vColor, 1.0); }`,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.pos.fill(-1e4);
  }

  setViewportHeight(h: number) {
    (this.points.material as THREE.ShaderMaterial).uniforms.scale.value = h;
  }

  burst(x: number, y: number, z: number, rgb: [number, number, number], count: number, spread: number) {
    for (let i = 0; i < count; i++) {
      const p = this.next;
      this.next = (this.next + 1) % MAX_PARTICLES;
      this.pos[p * 3] = x + (Math.random() - 0.5) * spread;
      this.pos[p * 3 + 1] = y + (Math.random() - 0.5) * spread;
      this.pos[p * 3 + 2] = z + (Math.random() - 0.5) * spread;
      this.vel[p * 3] = (Math.random() - 0.5) * 4;
      this.vel[p * 3 + 1] = Math.random() * 4 + 1;
      this.vel[p * 3 + 2] = (Math.random() - 0.5) * 4;
      const v = 0.75 + Math.random() * 0.35;
      this.col[p * 3] = (rgb[0] / 255) * v;
      this.col[p * 3 + 1] = (rgb[1] / 255) * v;
      this.col[p * 3 + 2] = (rgb[2] / 255) * v;
      this.life[p] = 0.5 + Math.random() * 0.5;
    }
  }

  update(dt: number) {
    let alive = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.life[i] <= 0) continue;
      alive = true;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[i * 3 + 1] = -1e4;
        continue;
      }
      this.vel[i * 3 + 1] -= 18 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    if (alive || this.wasAlive) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.color.needsUpdate = true;
    }
    this.wasAlive = alive;
  }
  private wasAlive = false;
}
