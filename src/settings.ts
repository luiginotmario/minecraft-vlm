import { DEFAULT_GESTURES, type GestureSettings } from './vision/gestures';

export interface Settings {
  viewDistance: number;
  /** Cap on device pixel ratio. 1 renders at CSS pixels, a quarter of the work on Retina. */
  pixelRatio: number;
  /** Frame rate cap; displays at 120 Hz would otherwise render twice as much. */
  maxFps: number;
  fov: number;
  mouseSensitivity: number;
  /** Degrees of view per degree of head turn, applied directly. */
  headGain: number;
  /** Head angle (deg) that maps to full turning speed. */
  headRange: number;
  /** Head angle (deg) below which the view doesn't keep turning. */
  headDeadzone: number;
  /** Max continuous turn speed (deg/s) when the head is held turned. */
  headTurnSpeed: number;
  invertYaw: boolean;
  invertPitch: boolean;
  showPreview: boolean;
  autoJump: boolean;
  sound: boolean;
  gestures: GestureSettings;
}

export const DEFAULTS: Settings = {
  viewDistance: 8,
  pixelRatio: 1,
  maxFps: 60,
  fov: 75,
  mouseSensitivity: 1,
  headGain: 1,
  headRange: 26,
  headDeadzone: 7,
  headTurnSpeed: 150,
  invertYaw: false,
  invertPitch: false,
  showPreview: true,
  autoJump: true,
  sound: true,
  gestures: { ...DEFAULT_GESTURES },
};

// v2: lighter defaults (1× resolution, 60 fps cap); older saves are ignored.
const KEY = 'mcvlm.settings.v2';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const s = JSON.parse(raw) as Partial<Settings>;
    return { ...structuredClone(DEFAULTS), ...s, gestures: { ...DEFAULT_GESTURES, ...(s.gestures ?? {}) } };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}
