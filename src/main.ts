import * as THREE from 'three';
import { Sfx } from './audio';
import { Interaction } from './game/interaction';
import { EYE, Player, type MoveInput } from './game/player';
import { createAtlas, createClouds, createSky, createWorldMaterials } from './render/materials';
import { BlockHighlight, Particles } from './render/effects';
import { Hand } from './render/hand';
import { loadSettings, type Settings } from './settings';
import { Hud } from './ui/hud';
import { Preview } from './ui/preview';
import { buildSettings } from './ui/settingsPanel';
import { CameraTracker } from './vision/camera';
import { GestureEngine, type GestureEvent } from './vision/gestures';
import type { VisionFrame } from './vision/protocol';
import { BLOCKS, HOTBAR, SEA } from './world/blocks';
import { createGenerator } from './world/gen';
import { generateTiles, tileAverage } from './world/textures';
import { World } from './world/world';

// All colours are authored in display space; skip three's colour management.
THREE.ColorManagement.enabled = false;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const settings: Settings = loadSettings();

// ───────────────────────── renderer & scene ─────────────────────────

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.autoClear = false;
renderer.info.autoReset = false;
$('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.05, 1000);
camera.rotation.order = 'YXZ';

const HORIZON = new THREE.Color(0xbcd8f2);
const ZENITH = new THREE.Color(0x4f8fdc);
const sky = createSky(HORIZON, ZENITH);
scene.add(sky);

const tiles = generateTiles();
const atlas = createAtlas(tiles);
const mats = createWorldMaterials(atlas);
mats.uniforms.fogColor.value.copy(HORIZON);

const world = new World(mats.opaque, mats.water, settings.viewDistance);
scene.add(world.group);
const clouds = createClouds(world.seed);
clouds.uniforms.fogColor.value.copy(HORIZON);
scene.add(clouds.mesh);

const highlight = new BlockHighlight();
scene.add(highlight.group);
const particles = new Particles();
scene.add(particles.points);
const hand = new Hand(mats.opaque);

const colors = BLOCKS.map((b) => tileAverage(tiles, b.tex[2]));
const sfx = new Sfx();
const player = new Player(world);
const interaction = new Interaction(world, player, highlight, particles, hand, sfx, colors);
const hud = new Hud(tiles);

let slot = 0;
const selectSlot = (i: number) => {
  slot = ((i % HOTBAR.length) + HOTBAR.length) % HOTBAR.length;
  hud.select(slot);
  hand.setBlock(HOTBAR[slot]);
};
selectSlot(0);

player.onStep = () => {
  const below = world.getBlock(Math.floor(player.x), Math.floor(player.y - 0.1), Math.floor(player.z));
  sfx.play('step', below === 3 || below === 4 ? 0.7 : 0.2);
};

function applySettings() {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, settings.pixelRatio));
  resize();
  if (world.radius !== settings.viewDistance) {
    world.radius = settings.viewDistance;
    world.update(player.x, player.z, true);
  }
  const far = settings.viewDistance * 16 - 6;
  mats.uniforms.fogFar.value = far;
  mats.uniforms.fogNear.value = far * 0.55;
  player.autoJump = settings.autoJump;
  sfx.enabled = settings.sound;
  gestures.settings = settings.gestures;
  preview.visible = settings.showPreview && tracker.active;
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  hand.resize(w / h);
  particles.setViewportHeight(h * renderer.getPixelRatio());
}
window.addEventListener('resize', resize);

// ───────────────────────── spawn & persistence ─────────────────────────

const PLAYER_KEY = 'mcvlm.player.v1';
let spawned = false;

(function initialPosition() {
  try {
    const saved = JSON.parse(localStorage.getItem(PLAYER_KEY) ?? 'null');
    if (saved && saved.seed === world.seed) {
      Object.assign(player, { x: saved.x, y: saved.y, z: saved.z, yaw: saved.yaw, pitch: saved.pitch, fly: !!saved.fly });
      spawned = true;
      return;
    }
  } catch {
    /* ignore */
  }
  // Spiral out from the origin to find dry land.
  const gen = createGenerator(world.seed);
  for (let r = 0; r < 400; r += 4) {
    for (let a = 0; a < 16; a++) {
      const x = Math.round(Math.cos((a / 16) * Math.PI * 2) * r);
      const z = Math.round(Math.sin((a / 16) * Math.PI * 2) * r);
      const h = gen.heightAt(x, z);
      if (h > SEA + 2 && h < 76) {
        player.x = x + 0.5;
        player.z = z + 0.5;
        return;
      }
    }
  }
})();

world.onChunk = () => {
  if (spawned) return;
  const y = world.surfaceY(Math.floor(player.x), Math.floor(player.z));
  if (y < 0) return;
  player.y = y + 1;
  spawned = true;
};

let lastSave = 0;
function savePlayer(now: number) {
  if (now - lastSave < 2000 || !spawned) return;
  lastSave = now;
  try {
    localStorage.setItem(
      PLAYER_KEY,
      JSON.stringify({ seed: world.seed, x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch, fly: player.fly }),
    );
  } catch {
    /* ignore */
  }
}

// ───────────────────────── input ─────────────────────────

const keys = new Set<string>();
let mouseMine = false;
let mousePlace = false;
let pointerLocked = false;
let menuOpen = true;
let showStats = false;
let jumpPulseUntil = 0;

const canvas = renderer.domElement;
const lockPointer = () => {
  try {
    const r = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
    r?.catch?.(() => {});
  } catch {
    /* pointer lock unavailable (e.g. embedded browsers) */
  }
};

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && !pointerLocked) {
    setMenu(!menuOpen);
    return;
  }
  if (menuOpen) return;
  keys.add(e.code);
  if (e.code.startsWith('Digit')) {
    const n = Number(e.code.slice(5));
    if (n >= 1 && n <= 9) selectSlot(n - 1);
  }
  if (e.code === 'KeyF' && !e.repeat) {
    player.fly = !player.fly;
    player.vy = 0;
    hud.gesture(player.fly ? 'Flying' : 'Walking');
  }
  if (e.code === 'KeyC' && !e.repeat && tracker.active) gestures.calibrate();
  if (e.code === 'KeyV' && !e.repeat) void toggleCamera();
  if (e.code === 'F3') {
    e.preventDefault();
    showStats = !showStats;
    if (!showStats) hud.stats('');
  }
  if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => {
  keys.clear();
  mouseMine = mousePlace = false;
});

canvas.addEventListener('mousedown', (e) => {
  if (menuOpen) return;
  if (!pointerLocked) {
    lockPointer();
    // Without the camera the first click only grabs the mouse.
    if (!tracker.active) return;
  }
  if (e.button === 0) {
    mouseMine = true;
    mineTimer = 0;
  } else if (e.button === 2) {
    mousePlace = true;
    placeTimer = 0;
  }
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) mouseMine = false;
  if (e.button === 2) mousePlace = false;
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('wheel', (e) => {
  if (menuOpen) return;
  selectSlot(slot + (e.deltaY > 0 ? 1 : -1));
}, { passive: true });
document.addEventListener('mousemove', (e) => {
  if (!pointerLocked) return;
  const k = 0.0022 * settings.mouseSensitivity;
  player.yaw -= e.movementX * k;
  player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch - e.movementY * k));
});
document.addEventListener('pointerlockchange', () => {
  const was = pointerLocked;
  pointerLocked = document.pointerLockElement === canvas;
  // Esc releases the pointer before we see the key, so open the menu here.
  if (was && !pointerLocked && !menuOpen) setMenu(true);
});

// ───────────────────────── camera control ─────────────────────────

const video = $<HTMLVideoElement>('video');
const tracker = new CameraTracker(video);
const gestures = new GestureEngine(settings.gestures);
const preview = new Preview();
const menuStatus = $('menu-status');
let visionStatus = '';
let lastFaceSeen = 0;

tracker.onStatus = (s) => {
  visionStatus = s;
  if (!s) lastFaceSeen = performance.now(); // models ready: give the face a moment to show up
  menuStatus.textContent = s;
  menuStatus.classList.toggle('error', s.startsWith('Vision failed'));
};

const GESTURE_LABEL: Record<GestureEvent, string> = {
  hit: 'Hit',
  place: 'Place',
  next: 'Next block →',
  prev: '← Previous block',
  jump: 'Jump',
};

tracker.onResult = (frame: VisionFrame) => {
  const events = gestures.update(frame);
  if (gestures.faceVisible) lastFaceSeen = performance.now();
  if (settings.showPreview) {
    const stats = `${tracker.hz} Hz · ${tracker.inferMs.toFixed(0)} ms · ${tracker.delegate}`;
    preview.draw(frame, gestures, settings.headRange, settings.headDeadzone, stats);
  }
  if (menuOpen || !spawned) return;
  const now = performance.now();
  for (const ev of events) {
    hud.gesture(GESTURE_LABEL[ev]);
    switch (ev) {
      case 'hit': interaction.hit(now); break;
      case 'place': interaction.place(HOTBAR[slot]); break;
      case 'next': selectSlot(slot + 1); sfx.play('select'); break;
      case 'prev': selectSlot(slot - 1); sfx.play('select'); break;
      case 'jump': jumpPulseUntil = now + 220; break;
    }
  }
};

async function startCamera() {
  try {
    await tracker.start();
    gestures.calibrate();
    preview.visible = settings.showPreview;
    return true;
  } catch (err) {
    const name = (err as Error)?.name;
    tracker.onStatus?.(
      name === 'NotAllowedError'
        ? 'Camera permission was denied. Allow it in the address bar and try again.'
        : `Camera unavailable: ${(err as Error)?.message ?? err}`,
    );
    menuStatus.classList.add('error');
    return false;
  }
}

async function toggleCamera() {
  if (tracker.active) {
    tracker.stop();
    preview.visible = false;
    hud.gesture('Camera off');
  } else {
    await startCamera();
  }
}

// ───────────────────────── menu ─────────────────────────

function setMenu(open: boolean) {
  menuOpen = open;
  $('menu').hidden = !open;
  keys.clear();
  mouseMine = mousePlace = false;
  if (open && pointerLocked) document.exitPointerLock();
}

$('btn-play').addEventListener('click', () => {
  sfx.unlock();
  setMenu(false);
  lockPointer();
});
$('btn-camera').addEventListener('click', async () => {
  sfx.unlock();
  const ok = tracker.active || (await startCamera());
  if (ok) setMenu(false);
});
buildSettings($('settings-body'), settings, applySettings, {
  recalibrate: () => {
    gestures.calibrate();
    setMenu(false);
  },
  resetWorld: () => {
    try {
      localStorage.removeItem(PLAYER_KEY);
    } catch {
      /* ignore */
    }
    world.reset();
  },
});

// ───────────────────────── loop ─────────────────────────

const rad = THREE.MathUtils.degToRad;
let absYaw = 0, absPitch = 0;
let mineTimer = 0, placeTimer = 0;
let fovCurrent = settings.fov;
let last = performance.now();
let frames = 0, fpsTime = last, fps = 0, worstFrame = 0;
const move: MoveInput = { forward: 0, right: 0, jump: false, down: false, sprint: false };

/** Continuous turn rate (deg/s) for a head angle beyond the deadzone. */
function headRate(deg: number, range: number, dead: number, max: number) {
  const a = Math.abs(deg);
  if (a <= dead) return 0;
  const e = Math.min(1.25, (a - dead) / Math.max(1, range - dead));
  return Math.sign(deg) * max * Math.pow(e, 1.5);
}

function frame(now: number) {
  requestAnimationFrame(frame);
  tick(now);
}

function tick(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  worstFrame = Math.max(worstFrame, now - last);
  last = now;

  // Stream in chunk meshes; take a bigger slice while the world is loading.
  world.processInbox(spawned && world.loadedCount > 30 ? 3 : 12);
  world.update(player.x, player.z);

  const playing = !menuOpen && spawned;

  // Head look: direct offset plus joystick-style turning past the deadzone.
  let tYaw = 0, tPitch = 0;
  const headActive = tracker.active && gestures.faceVisible && gestures.isCalibrated && !gestures.calibrating;
  if (headActive && playing) {
    const yawDeg = gestures.yaw * (settings.invertYaw ? -1 : 1);
    const pitchDeg = gestures.pitch * (settings.invertPitch ? -1 : 1);
    player.yaw -= rad(headRate(yawDeg, settings.headRange, settings.headDeadzone, settings.headTurnSpeed)) * dt;
    player.pitch += rad(headRate(pitchDeg, settings.headRange * 0.8, settings.headDeadzone, settings.headTurnSpeed * 0.6)) * dt;
    player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch));
    tYaw = rad(yawDeg * settings.headGain);
    tPitch = rad(pitchDeg * settings.headGain);
  }
  const k = 1 - Math.exp(-dt / 0.04);
  absYaw += (tYaw - absYaw) * k;
  absPitch += (tPitch - absPitch) * k;
  const viewYaw = player.yaw - absYaw;
  const viewPitch = Math.max(-1.55, Math.min(1.55, player.pitch + absPitch));

  if (playing) {
    const key = (c: string) => (keys.has(c) ? 1 : 0);
    const jogging = tracker.active ? gestures.jog : 0;
    move.forward = Math.max(-1, Math.min(1, key('KeyW') - key('KeyS') + (jogging ? 1 : 0) + (tracker.active ? gestures.lean : 0)));
    move.right = key('KeyD') - key('KeyA');
    move.jump = keys.has('Space') || now < jumpPulseUntil;
    move.down = player.fly && (keys.has('ShiftLeft') || keys.has('ShiftRight'));
    move.sprint = !player.fly && (keys.has('ShiftLeft') || keys.has('ShiftRight') || jogging === 2);
    player.update(dt, move, viewYaw);
    if (move.jump && player.onGround === false && now < jumpPulseUntil && player.vy > 0) jumpPulseUntil = 0;
  }

  // Camera.
  const moving = playing && player.onGround && Math.hypot(player.vx, player.vz) > 0.5;
  const bob = moving ? Math.sin(player.walkDist * 1.6 * 2) * 0.035 : 0;
  camera.position.set(player.x, player.y + EYE + bob, player.z);
  camera.rotation.set(viewPitch, viewYaw, 0);
  const sprinting = move.sprint && Math.hypot(player.vx, player.vz) > 5;
  const fovTarget = settings.fov + (sprinting ? 8 : 0);
  if (Math.abs(fovCurrent - fovTarget) > 0.01) {
    fovCurrent += (fovTarget - fovCurrent) * (1 - Math.exp(-dt / 0.12));
    camera.fov = fovCurrent;
    camera.updateProjectionMatrix();
  }
  camera.updateMatrixWorld();
  sky.position.copy(camera.position);
  clouds.mesh.position.set(camera.position.x, 118, camera.position.z);
  clouds.uniforms.time.value = now / 1000;

  // Targeting and held actions (mouse or pinch).
  if (playing) {
    interaction.updateTarget(camera, now);
    const holdMine = mouseMine || (tracker.active && gestures.mineHold);
    if (holdMine) {
      mineTimer -= dt;
      if (mineTimer <= 0) {
        interaction.hit(now);
        mineTimer = 0.24;
      }
    } else {
      mineTimer = 0;
    }
    if (mousePlace) {
      placeTimer -= dt;
      if (placeTimer <= 0) {
        interaction.place(HOTBAR[slot]);
        placeTimer = 0.25;
      }
    }
  }

  particles.update(dt);
  hand.update(dt, player.walkDist, moving);
  mats.uniforms.time.value = now / 1000;

  renderer.info.reset();
  renderer.clear();
  renderer.render(scene, camera);
  renderer.clearDepth();
  renderer.render(hand.scene, hand.camera);

  // Status line.
  let status = '';
  if (!spawned) status = 'Generating world…';
  else if (visionStatus && !menuOpen) status = visionStatus;
  else if (tracker.active && !menuOpen) {
    if (now - lastFaceSeen > 1500) status = "Can't see your face. Move into the camera's view.";
    else if (gestures.calibrating) status = 'Look at the screen and hold still…';
  }
  hud.status(status);

  frames++;
  if (now - fpsTime > 500) {
    fps = Math.round((frames * 1000) / (now - fpsTime));
    frames = 0;
    fpsTime = now;
    if (showStats) {
      const info = renderer.info.render;
      hud.stats(
        `${fps} fps  worst ${worstFrame.toFixed(1)} ms\n` +
          `chunks ${world.loadedCount}  draws ${info.calls}  tris ${(info.triangles / 1000).toFixed(0)}k\n` +
          `xyz ${player.x.toFixed(1)} ${player.y.toFixed(1)} ${player.z.toFixed(1)}${player.fly ? '  fly' : ''}\n` +
          (tracker.active
            ? `vision ${tracker.hz} Hz  infer ${tracker.inferMs.toFixed(1)} ms  lag ${tracker.latencyMs.toFixed(0)} ms  ${tracker.delegate}\n` +
              `head ${gestures.yaw.toFixed(1)}° ${gestures.pitch.toFixed(1)}°  jog ${gestures.jog}` +
              gestures.hands
                .map((h) => `\nhand ${h.id}: vx ${h.vx.toFixed(1)} vy ${h.vy.toFixed(1)} fingers ${h.fingers}${h.pinched ? ' pinch' : ''}`)
                .join('')
            : 'camera off'),
      );
    }
    worstFrame = 0;
  }
  savePlayer(now);
}

applySettings();
world.update(player.x, player.z, true);
requestAnimationFrame(frame);

// Expose a few handles for debugging in the console.
Object.assign(window, { __game: { world, player, gestures, tracker, settings, hand, renderer, camera, scene, tick } });
