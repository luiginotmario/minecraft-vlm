import { DEFAULTS, saveSettings, type Settings } from '../settings';

type Range = { kind: 'range'; label: string; min: number; max: number; step: number; get: () => number; set: (v: number) => void; fmt?: (v: number) => string };
type Toggle = { kind: 'toggle'; label: string; get: () => boolean; set: (v: boolean) => void };
type Group = { kind: 'group'; label: string };
type Item = Range | Toggle | Group;

/** Builds the settings form; `onChange` runs after every edit. */
export function buildSettings(
  root: HTMLElement,
  s: Settings,
  onChange: () => void,
  actions: { recalibrate: () => void; resetWorld: () => void },
) {
  const g = s.gestures;
  const items: Item[] = [
    { kind: 'group', label: 'Head look' },
    { kind: 'range', label: 'Direct look', min: 0, max: 2, step: 0.05, get: () => s.headGain, set: (v) => (s.headGain = v), fmt: (v) => `${v.toFixed(2)}×` },
    { kind: 'range', label: 'Turn speed', min: 30, max: 300, step: 5, get: () => s.headTurnSpeed, set: (v) => (s.headTurnSpeed = v), fmt: (v) => `${v}°/s` },
    { kind: 'range', label: 'Deadzone', min: 0, max: 20, step: 0.5, get: () => s.headDeadzone, set: (v) => (s.headDeadzone = v), fmt: (v) => `${v}°` },
    { kind: 'range', label: 'Full-speed angle', min: 10, max: 45, step: 1, get: () => s.headRange, set: (v) => (s.headRange = v), fmt: (v) => `${v}°` },
    { kind: 'toggle', label: 'Invert left/right', get: () => s.invertYaw, set: (v) => (s.invertYaw = v) },
    { kind: 'toggle', label: 'Invert up/down', get: () => s.invertPitch, set: (v) => (s.invertPitch = v) },

    { kind: 'group', label: 'Gestures' },
    { kind: 'range', label: 'Sensitivity', min: 0.5, max: 2, step: 0.05, get: () => g.sensitivity, set: (v) => (g.sensitivity = v), fmt: (v) => `${v.toFixed(2)}×` },
    { kind: 'toggle', label: 'Chop to mine', get: () => g.swing, set: (v) => (g.swing = v) },
    { kind: 'toggle', label: 'Punch to mine', get: () => g.push, set: (v) => (g.push = v) },
    { kind: 'toggle', label: 'Swipe to switch block', get: () => g.swipe, set: (v) => (g.swipe = v) },
    { kind: 'toggle', label: 'Pinch to place', get: () => g.pinch, set: (v) => (g.pinch = v) },
    { kind: 'toggle', label: 'Jog in place to walk', get: () => g.jog, set: (v) => (g.jog = v) },
    { kind: 'toggle', label: 'Hop to jump', get: () => g.jump, set: (v) => (g.jump = v) },
    { kind: 'toggle', label: 'Lean in to walk', get: () => g.lean, set: (v) => (g.lean = v) },
    { kind: 'toggle', label: 'Show camera preview', get: () => s.showPreview, set: (v) => (s.showPreview = v) },

    { kind: 'group', label: 'Game' },
    { kind: 'range', label: 'View distance', min: 3, max: 14, step: 1, get: () => s.viewDistance, set: (v) => (s.viewDistance = v), fmt: (v) => `${v}` },
    { kind: 'range', label: 'Resolution', min: 0.5, max: 2, step: 0.25, get: () => s.pixelRatio, set: (v) => (s.pixelRatio = v), fmt: (v) => `${v}×` },
    { kind: 'range', label: 'Field of view', min: 50, max: 110, step: 1, get: () => s.fov, set: (v) => (s.fov = v), fmt: (v) => `${v}°` },
    { kind: 'range', label: 'Mouse sensitivity', min: 0.2, max: 3, step: 0.05, get: () => s.mouseSensitivity, set: (v) => (s.mouseSensitivity = v), fmt: (v) => `${v.toFixed(2)}×` },
    { kind: 'toggle', label: 'Auto-jump', get: () => s.autoJump, set: (v) => (s.autoJump = v) },
    { kind: 'toggle', label: 'Sound', get: () => s.sound, set: (v) => (s.sound = v) },
  ];

  const render = () => {
    root.replaceChildren();
    for (const it of items) {
      if (it.kind === 'group') {
        const h = document.createElement('div');
        h.className = 'setting-group';
        h.textContent = it.label;
        root.appendChild(h);
        continue;
      }
      const row = document.createElement('label');
      row.className = 'setting';
      const name = document.createElement('span');
      name.textContent = it.label;
      row.appendChild(name);
      if (it.kind === 'range') {
        const wrap = document.createElement('span');
        wrap.style.display = 'flex';
        wrap.style.alignItems = 'center';
        wrap.style.gap = '8px';
        const input = document.createElement('input');
        input.type = 'range';
        input.min = String(it.min);
        input.max = String(it.max);
        input.step = String(it.step);
        input.value = String(it.get());
        const out = document.createElement('output');
        const fmt = it.fmt ?? ((v: number) => String(v));
        out.textContent = fmt(it.get());
        input.addEventListener('input', () => {
          it.set(Number(input.value));
          out.textContent = fmt(it.get());
          saveSettings(s);
          onChange();
        });
        wrap.append(input, out);
        row.appendChild(wrap);
      } else {
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = it.get();
        input.addEventListener('change', () => {
          it.set(input.checked);
          saveSettings(s);
          onChange();
        });
        row.appendChild(input);
      }
      root.appendChild(row);
    }
    const act = document.createElement('div');
    act.className = 'setting-actions';
    const mk = (label: string, fn: () => void) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', fn);
      act.appendChild(b);
    };
    mk('Recalibrate head', actions.recalibrate);
    mk('Reset settings', () => {
      Object.assign(s, structuredClone(DEFAULTS));
      saveSettings(s);
      render();
      onChange();
    });
    mk('New world', () => {
      if (confirm('Delete your edits and generate a new world?')) actions.resetWorld();
    });
    root.appendChild(act);
  };
  render();
}
