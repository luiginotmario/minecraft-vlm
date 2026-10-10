import type { MeshData } from './mesher';

export type ToWorker =
  | { t: 'init'; seed: number; edits: [number, number, number, number][] }
  | { t: 'center'; cx: number; cz: number; radius: number }
  | { t: 'set'; x: number; y: number; z: number; id: number }
  | { t: 'height'; x: number; z: number };

export type FromWorker =
  | { t: 'chunk'; cx: number; cz: number; voxels: Uint8Array; opaque: MeshData | null; water: MeshData | null }
  | { t: 'mesh'; cx: number; cz: number; opaque: MeshData | null; water: MeshData | null }
  | { t: 'height'; x: number; z: number; y: number };
