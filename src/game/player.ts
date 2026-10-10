import { IS_SOLID, WATER } from '../world/blocks';
import type { World } from '../world/world';

export const HALF_W = 0.3;
export const HEIGHT = 1.8;
export const EYE = 1.62;

const GRAVITY = 28;
const JUMP_V = 8.6;
const WALK = 4.3;
const SPRINT = 6.4;
const FLY = 12;
const EPS = 1e-4;

export interface MoveInput {
  forward: number; // -1..1
  right: number; // -1..1
  jump: boolean;
  down: boolean;
  sprint: boolean;
}

export class Player {
  x = 8.5;
  y = 80;
  z = 8.5;
  vx = 0;
  vy = 0;
  vz = 0;
  /** View angles in radians; yaw 0 looks toward -z. */
  yaw = 0;
  pitch = 0;
  onGround = false;
  inWater = false;
  fly = false;
  autoJump = true;
  /** Accumulated walk distance, drives view bob and footsteps. */
  walkDist = 0;
  onStep?: () => void;
  private stepAcc = 0;

  constructor(private world: World) {}

  private solidAt(x: number, y: number, z: number) {
    return IS_SOLID[this.world.getBlock(x, y, z)] === 1;
  }

  /** Does the player's box at the current position overlap any solid block? */
  private overlaps(px: number, py: number, pz: number) {
    const x0 = Math.floor(px - HALF_W), x1 = Math.floor(px + HALF_W - EPS);
    const y0 = Math.floor(py), y1 = Math.floor(py + HEIGHT - EPS);
    const z0 = Math.floor(pz - HALF_W), z1 = Math.floor(pz + HALF_W - EPS);
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) if (this.solidAt(x, y, z)) return true;
    return false;
  }

  /** Would a block at (bx,by,bz) intersect the player? */
  intersectsBlock(bx: number, by: number, bz: number) {
    return (
      bx + 1 > this.x - HALF_W && bx < this.x + HALF_W &&
      by + 1 > this.y && by < this.y + HEIGHT &&
      bz + 1 > this.z - HALF_W && bz < this.z + HALF_W
    );
  }

  /**
   * Stand on a block placed at the player's feet: lift the player one block
   * if there's headroom. Returns false (and doesn't move) if there isn't.
   */
  liftOnto(blockY: number) {
    const y = blockY + 1 + EPS;
    if (this.overlaps(this.x, y, this.z)) return false;
    this.y = y;
    this.vy = Math.max(0, this.vy);
    this.onGround = true;
    return true;
  }

  /** Move along one axis, stopping flush against blocks. Returns true on collision. */
  private moveAxis(axis: 0 | 1 | 2, d: number) {
    if (d === 0) return false;
    const steps = Math.ceil(Math.abs(d) / 0.45);
    const s = d / steps;
    for (let i = 0; i < steps; i++) {
      const nx = axis === 0 ? this.x + s : this.x;
      const ny = axis === 1 ? this.y + s : this.y;
      const nz = axis === 2 ? this.z + s : this.z;
      if (!this.overlaps(nx, ny, nz)) {
        this.x = nx;
        this.y = ny;
        this.z = nz;
        continue;
      }
      // Snap flush to the block face we hit.
      if (axis === 0) this.x = s > 0 ? Math.floor(nx + HALF_W) - HALF_W - EPS : Math.floor(nx - HALF_W) + 1 + HALF_W + EPS;
      else if (axis === 1) this.y = s > 0 ? Math.floor(ny + HEIGHT) - HEIGHT - EPS : Math.floor(ny) + 1 + EPS;
      else this.z = s > 0 ? Math.floor(nz + HALF_W) - HALF_W - EPS : Math.floor(nz - HALF_W) + 1 + HALF_W + EPS;
      if (this.overlaps(this.x, this.y, this.z)) {
        // Snapping failed (e.g. spawned inside terrain); undo.
        if (axis === 0) this.x = nx - s;
        else if (axis === 1) this.y = ny - s;
        else this.z = nz - s;
      }
      return true;
    }
    return false;
  }

  update(dt: number, input: MoveInput, viewYaw: number) {
    // Freeze until the chunk under us exists, otherwise we'd fall through the world.
    if (!this.world.isLoadedAt(this.x, this.z)) return;

    const feet = this.world.getBlock(Math.floor(this.x), Math.floor(this.y + 0.2), Math.floor(this.z));
    const chest = this.world.getBlock(Math.floor(this.x), Math.floor(this.y + 1.1), Math.floor(this.z));
    this.inWater = feet === WATER || chest === WATER;

    // Desired horizontal velocity in world space.
    let f = input.forward, r = input.right;
    const len = Math.hypot(f, r);
    if (len > 1) { f /= len; r /= len; }
    const speed = this.fly ? FLY : input.sprint ? SPRINT : WALK;
    const sin = Math.sin(viewYaw), cos = Math.cos(viewYaw);
    const tx = (-sin * f + cos * r) * speed * (this.inWater && !this.fly ? 0.6 : 1);
    const tz = (-cos * f - sin * r) * speed * (this.inWater && !this.fly ? 0.6 : 1);
    const accel = this.fly ? 10 : this.onGround ? 16 : this.inWater ? 6 : 4;
    const k = 1 - Math.exp(-accel * dt);
    this.vx += (tx - this.vx) * k;
    this.vz += (tz - this.vz) * k;

    if (this.fly) {
      const ty = (input.jump ? 1 : 0) - (input.down ? 1 : 0);
      this.vy += (ty * FLY * 0.8 - this.vy) * k;
    } else if (this.inWater) {
      this.vy -= GRAVITY * 0.25 * dt;
      if (input.jump) this.vy = Math.min(this.vy + 30 * dt, 3.5);
      this.vy *= Math.exp(-2.5 * dt);
    } else {
      this.vy -= GRAVITY * dt;
      if (input.jump && this.onGround) this.vy = JUMP_V;
      if (this.vy < -55) this.vy = -55;
    }

    const wasGround = this.onGround;
    const startX = this.x, startZ = this.z;
    const hitY = this.moveAxis(1, this.vy * dt);
    if (hitY) {
      this.onGround = this.vy < 0;
      this.vy = 0;
    } else {
      this.onGround = false;
    }
    const hitX = this.moveAxis(0, this.vx * dt);
    const hitZ = this.moveAxis(2, this.vz * dt);
    if (hitX) this.vx = 0;
    if (hitZ) this.vz = 0;

    // Auto-jump onto one-block ledges while walking into them.
    if (this.autoJump && !this.fly && (hitX || hitZ) && (wasGround || this.onGround) && len > 0.1) {
      const ax = Math.floor(this.x + Math.sign(tx) * (HALF_W + 0.2));
      const az = Math.floor(this.z + Math.sign(tz) * (HALF_W + 0.2));
      const fy = Math.floor(this.y);
      const blocked = this.solidAt(hitX ? ax : Math.floor(this.x), fy, hitZ ? az : Math.floor(this.z));
      const clear =
        !this.solidAt(hitX ? ax : Math.floor(this.x), fy + 1, hitZ ? az : Math.floor(this.z)) &&
        !this.solidAt(hitX ? ax : Math.floor(this.x), fy + 2, hitZ ? az : Math.floor(this.z));
      if (blocked && clear) this.vy = JUMP_V;
    }

    if (this.onGround && !this.fly) {
      const moved = Math.hypot(this.x - startX, this.z - startZ);
      this.walkDist += moved;
      this.stepAcc += moved;
      if (this.stepAcc > 2.1) {
        this.stepAcc = 0;
        this.onStep?.();
      }
    }

    if (this.y < -20) this.y = 100; // fell out of the world
  }
}
