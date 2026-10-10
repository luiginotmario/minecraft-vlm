import * as THREE from 'three';
import { BLOCKS } from '../world/blocks';

// Faces of BoxGeometry in order: +x, -x, +y, -y, +z, -z.
const FACE_SHADE = [0.78, 0.78, 1.0, 0.5, 0.64, 0.64];

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/** First-person held block, drawn in its own pass on top of the world. */
export class Hand {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.05, 10);
  private mesh: THREE.Mesh;
  private geo = new THREE.BoxGeometry(0.24, 0.24, 0.24);
  private swingT = 1;
  private placeT = 1;
  private switchT = 1;
  private current = -1;

  constructor(material: THREE.Material) {
    const lt = new Float32Array(24 * 2);
    this.geo.setAttribute('lt', new THREE.BufferAttribute(lt, 2));
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  setBlock(id: number) {
    if (id === this.current) return;
    this.current = id;
    const lt = this.geo.getAttribute('lt') as THREE.BufferAttribute;
    const tex = BLOCKS[id].tex;
    for (let f = 0; f < 6; f++) {
      const layer = f === 2 ? tex[0] : f === 3 ? tex[1] : tex[2];
      for (let v = 0; v < 4; v++) lt.setXY(f * 4 + v, layer, FACE_SHADE[f]);
    }
    lt.needsUpdate = true;
    this.switchT = 0;
  }

  swing() {
    this.swingT = 0;
  }

  place() {
    this.placeT = 0;
  }

  resize(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number, walkDist: number, moving: boolean) {
    this.swingT = Math.min(1, this.swingT + dt / 0.22);
    this.placeT = Math.min(1, this.placeT + dt / 0.16);
    this.switchT = Math.min(1, this.switchT + dt / 0.18);

    const bobAmt = moving ? 1 : 0;
    const bx = Math.cos(walkDist * 1.6) * 0.018 * bobAmt;
    const by = Math.abs(Math.sin(walkDist * 1.6)) * 0.022 * bobAmt;

    // Swing: a quick chop down and in, then recover.
    const s = this.swingT < 1 ? Math.sin(easeOut(this.swingT) * Math.PI) : 0;
    const p = this.placeT < 1 ? Math.sin(easeOut(this.placeT) * Math.PI) : 0;
    const drop = 1 - easeOut(this.switchT);

    this.mesh.position.set(0.52 + bx - s * 0.2, -0.4 + by - s * 0.1 - drop * 0.3, -0.85 - s * 0.15 + p * 0.12);
    this.mesh.rotation.set(0.22 - s * 0.9, 0.62 + s * 0.35, 0.04);
  }
}
