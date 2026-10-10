import type * as THREE from 'three';
import type { Sfx } from '../audio';
import type { BlockHighlight, Particles } from '../render/effects';
import type { Hand } from '../render/hand';
import { AIR, BLOCKS, BRICK, COAL, COBBLE, DIRT, GLASS, GRASS, IRON, LEAVES, LOG, PLANKS, SAND, SNOW, STONE, WATER } from '../world/blocks';
import type { World } from '../world/world';
import type { Player } from './player';
import { raycast, type Hit } from './raycast';

const REACH = 6;
const DAMAGE_DECAY_MS = 1600;

/** Rough material pitch for sounds. */
function tone(id: number) {
  switch (id) {
    case GLASS: return 1;
    case STONE: case COBBLE: case BRICK: case COAL: case IRON: return 0.8;
    case LOG: case PLANKS: return 0.5;
    case LEAVES: return 0.35;
    case GRASS: case DIRT: case SAND: case SNOW: return 0.15;
    default: return 0.5;
  }
}

export class Interaction {
  readonly target: Hit = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, id: 0 };
  hasTarget = false;
  private damage = 0;
  private dx = NaN;
  private dy = NaN;
  private dz = NaN;
  private lastHit = 0;
  private dir = { x: 0, y: 0, z: 0 };

  constructor(
    private world: World,
    private player: Player,
    private highlight: BlockHighlight,
    private particles: Particles,
    private hand: Hand,
    private sfx: Sfx,
    private colors: [number, number, number][],
  ) {}

  updateTarget(camera: THREE.PerspectiveCamera, now: number) {
    const e = camera.matrixWorld.elements;
    // Camera looks down its local -z.
    this.dir.x = -e[8];
    this.dir.y = -e[9];
    this.dir.z = -e[10];
    const p = camera.position;
    this.hasTarget = raycast(this.world, p.x, p.y, p.z, this.dir.x, this.dir.y, this.dir.z, REACH, this.target);
    if (!this.hasTarget) {
      this.highlight.hide();
      return;
    }
    const t = this.target;
    this.highlight.set(t.x, t.y, t.z);
    const same = t.x === this.dx && t.y === this.dy && t.z === this.dz;
    if (!same || now - this.lastHit > DAMAGE_DECAY_MS) {
      if (this.damage > 0) {
        this.damage = 0;
        this.highlight.damage(0);
      }
    }
  }

  /** One swing at the targeted block. Returns true if a block broke. */
  hit(now: number): boolean {
    this.hand.swing();
    if (!this.hasTarget) return false;
    const t = this.target;
    const def = BLOCKS[t.id];
    if (t.x !== this.dx || t.y !== this.dy || t.z !== this.dz) {
      this.dx = t.x;
      this.dy = t.y;
      this.dz = t.z;
      this.damage = 0;
    }
    const color = this.colors[t.id];
    this.lastHit = now;
    if (def.hits === 0) {
      this.sfx.play('hit', tone(t.id));
      return false;
    }
    this.damage++;
    const fx = t.x + 0.5 + t.nx * 0.52, fy = t.y + 0.5 + t.ny * 0.52, fz = t.z + 0.5 + t.nz * 0.52;
    if (this.damage >= def.hits) {
      this.world.setBlock(t.x, t.y, t.z, AIR);
      this.particles.burst(t.x + 0.5, t.y + 0.5, t.z + 0.5, color, 26, 0.8);
      this.sfx.play('break', tone(t.id));
      this.damage = 0;
      this.highlight.damage(0);
      this.dx = NaN;
      return true;
    }
    this.particles.burst(fx, fy, fz, color, 6, 0.25);
    this.sfx.play('hit', tone(t.id));
    this.highlight.damage(this.damage / def.hits);
    return false;
  }

  place(id: number): boolean {
    this.hand.place();
    if (!this.hasTarget) return false;
    const t = this.target;
    const bx = t.x + t.nx, by = t.y + t.ny, bz = t.z + t.nz;
    const existing = this.world.getBlock(bx, by, bz);
    if (existing !== AIR && existing !== WATER) return false;
    if (BLOCKS[id].solid && this.player.intersectsBlock(bx, by, bz)) return false;
    this.world.setBlock(bx, by, bz, id);
    this.sfx.play('place', tone(id));
    return true;
  }
}
