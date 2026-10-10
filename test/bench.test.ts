import { it } from 'vitest';
import { createGenerator } from '../src/world/gen';
import { buildPadded, meshChunk, PX, PY } from '../src/world/mesher';
import { chunkKey } from '../src/world/blocks';

it.skipIf(!(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.BENCH)('bench gen + mesh', () => {
  const gen = createGenerator(12345);
  const data = new Map<number, Uint8Array>();
  const R = 6;
  let t = performance.now();
  for (let z = -R - 1; z <= R + 1; z++) for (let x = -R - 1; x <= R + 1; x++) data.set(chunkKey(x, z), gen.generate(x, z));
  const genMs = (performance.now() - t) / data.size;
  const pad = new Uint8Array(PX * PX * PY);
  let verts = 0, n = 0, quads = 0;
  t = performance.now();
  for (let z = -R; z <= R; z++) for (let x = -R; x <= R; x++) {
    buildPadded(pad, x, z, (a, b) => data.get(chunkKey(a, b)));
    const m = meshChunk(pad);
    verts += (m.opaque?.pos.length ?? 0) / 3 + (m.water?.pos.length ?? 0) / 3;
    quads += ((m.opaque?.idx.length ?? 0) + (m.water?.idx.length ?? 0)) / 6;
    n++;
  }
  const meshMs = (performance.now() - t) / n;
  console.log(JSON.stringify({ genMs: genMs.toFixed(2), meshMs: meshMs.toFixed(2), avgVerts: Math.round(verts / n), avgQuads: Math.round(quads / n) }));
});
