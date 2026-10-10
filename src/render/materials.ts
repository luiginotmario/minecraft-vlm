import * as THREE from 'three';
import { TILE_COUNT } from '../world/blocks';
import { makeNoise } from '../world/noise';
import { TILE } from '../world/textures';

/** Upload tiles (top row first) into a mipmapped texture array, flipped so t=1 is the top. */
export function createAtlas(tiles: Uint8Array) {
  const flipped = new Uint8Array(tiles.length);
  const row = TILE * 4;
  for (let l = 0; l < TILE_COUNT; l++) {
    const base = l * TILE * row;
    for (let y = 0; y < TILE; y++) {
      flipped.set(tiles.subarray(base + y * row, base + (y + 1) * row), base + (TILE - 1 - y) * row);
    }
  }
  const tex = new THREE.DataArrayTexture(flipped, TILE, TILE, TILE_COUNT);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export interface WorldUniforms {
  atlas: { value: THREE.DataArrayTexture };
  fogColor: { value: THREE.Color };
  fogNear: { value: number };
  fogFar: { value: number };
  time: { value: number };
  [k: string]: THREE.IUniform;
}

const VERT = /* glsl */ `
in vec3 position;
in vec2 uv;
in vec2 lt;
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 cameraPosition;
uniform float time;
out vec2 vUv;
flat out float vLayer;
out float vLight;
out vec2 vWorldXZ;
#ifdef WATER
out float vWave;
#endif
void main() {
  vUv = uv;
  vLayer = lt.x;
  vLight = lt.y;
  vec4 world = modelMatrix * vec4(position, 1.0);
#ifdef WATER
  vUv += vec2(time * 0.03, time * 0.017);
  vWave = sin(world.x * 0.9 + time * 1.4) * cos(world.z * 0.7 + time * 1.1);
#endif
  vWorldXZ = world.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray atlas;
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
uniform vec3 cameraPosition;
in vec2 vUv;
flat in float vLayer;
in float vLight;
in vec2 vWorldXZ;
#ifdef WATER
in float vWave;
#endif
out vec4 fragColor;
void main() {
  vec4 c = texture(atlas, vec3(vUv, vLayer));
#ifdef WATER
  vec3 col = c.rgb * vLight * (0.92 + 0.08 * vWave);
  float a = 0.72;
#else
  if (c.a < 0.5) discard;
  vec3 col = c.rgb * vLight;
  float a = 1.0;
#endif
  // Per pixel: greedy quads are large, so interpolated distance would be off.
  float f = smoothstep(fogNear, fogFar, length(vWorldXZ - cameraPosition.xz));
  fragColor = vec4(mix(col, fogColor, f), a);
}
`;

export function createWorldMaterials(atlas: THREE.DataArrayTexture) {
  const uniforms: WorldUniforms = {
    atlas: { value: atlas },
    fogColor: { value: new THREE.Color() },
    fogNear: { value: 80 },
    fogFar: { value: 120 },
    time: { value: 0 },
  };
  const opaque = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
  });
  const water = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
    defines: { WATER: 1 },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  return { uniforms, opaque, water };
}

/** Gradient sky dome that follows the camera. */
export function createSky(horizon: THREE.Color, zenith: THREE.Color) {
  const geo = new THREE.SphereGeometry(400, 24, 12);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: { horizon: { value: horizon }, zenith: { value: zenith } },
    vertexShader: /* glsl */ `
      varying float vY;
      void main() {
        vY = normalize(position).y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 horizon;
      uniform vec3 zenith;
      varying float vY;
      void main() {
        float t = pow(clamp(vY, 0.0, 1.0), 0.6);
        gl_FragColor = vec4(mix(horizon, zenith, t), 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  return mesh;
}

/** Flat blocky cloud layer that drifts slowly and follows the camera. */
export function createClouds(seed: number) {
  const N = 64;
  const data = new Uint8Array(N * N * 4);
  const noise = makeNoise(seed ^ 0x5eed);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      // Tileable by sampling noise on a torus.
      const a = (x / N) * Math.PI * 2, b = (y / N) * Math.PI * 2;
      const v = noise.n3(Math.cos(a) * 3, Math.sin(a) * 3 + Math.cos(b) * 3, Math.sin(b) * 3);
      const i = (y * N + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = v > 0.18 ? 255 : 0;
    }
  }
  const tex = new THREE.DataTexture(data, N, N);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;

  const uniforms = {
    map: { value: tex },
    time: { value: 0 },
    fogColor: { value: new THREE.Color() },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform float time;
      uniform vec3 fogColor;
      varying vec2 vWorld;
      void main() {
        // Per pixel: the plane has only four vertices, so a varying would be constant.
        float vDist = length(vWorld - cameraPosition.xz);
        vec2 uv = (vWorld + vec2(time * 1.2, 0.0)) / (64.0 * 12.0);
        float a = texture2D(map, uv).a;
        if (a < 0.5) discard;
        float fade = 1.0 - smoothstep(180.0, 420.0, vDist);
        gl_FragColor = vec4(mix(fogColor, vec3(1.0), fade), 0.8 * fade);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return { mesh, uniforms };
}
