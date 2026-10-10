import { AIR, WATER } from '../world/blocks';
import type { World } from '../world/world';

export interface Hit {
  x: number;
  y: number;
  z: number;
  /** Face normal of the entered face. */
  nx: number;
  ny: number;
  nz: number;
  id: number;
}

/** Voxel DDA (Amanatides & Woo). Writes into `out` to avoid allocating. */
export function raycast(
  world: World,
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxDist: number,
  out: Hit,
): boolean {
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz);
  const tdx = sx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tdy = sy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tdz = sz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tmx = sx > 0 ? (x + 1 - ox) * tdx : sx < 0 ? (ox - x) * tdx : Infinity;
  let tmy = sy > 0 ? (y + 1 - oy) * tdy : sy < 0 ? (oy - y) * tdy : Infinity;
  let tmz = sz > 0 ? (z + 1 - oz) * tdz : sz < 0 ? (oz - z) * tdz : Infinity;
  let nx = 0, ny = 0, nz = 0;
  let t = 0;
  while (t <= maxDist) {
    const id = world.getBlock(x, y, z);
    if (id !== AIR && id !== WATER) {
      out.x = x; out.y = y; out.z = z;
      out.nx = nx; out.ny = ny; out.nz = nz;
      out.id = id;
      return true;
    }
    if (tmx < tmy && tmx < tmz) {
      x += sx; t = tmx; tmx += tdx; nx = -sx; ny = 0; nz = 0;
    } else if (tmy < tmz) {
      y += sy; t = tmy; tmy += tdy; nx = 0; ny = -sy; nz = 0;
    } else {
      z += sz; t = tmz; tmz += tdz; nx = 0; ny = 0; nz = -sz;
    }
  }
  return false;
}
