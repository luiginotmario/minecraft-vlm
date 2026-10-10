// Tiny synthesized sound effects; no audio files.

type Kind = 'hit' | 'break' | 'place' | 'step' | 'select';

export class Sfx {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private master: GainNode | null = null;
  enabled = true;

  /** Must be called from a user gesture. */
  unlock() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
    } catch {
      return;
    }
    const len = this.ctx.sampleRate * 0.5;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
  }

  /** `tone` roughly maps material: low for dirt, high for stone/glass. */
  play(kind: Kind, tone = 0.5) {
    const ctx = this.ctx;
    if (!ctx || !this.noise || !this.master || !this.enabled) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    src.connect(filter).connect(gain).connect(this.master);

    let dur = 0.08;
    switch (kind) {
      case 'hit':
        filter.type = 'bandpass';
        filter.frequency.value = 400 + tone * 1800;
        filter.Q.value = 1.2;
        gain.gain.setValueAtTime(0.9, t);
        dur = 0.07;
        break;
      case 'break':
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(900 + tone * 2400, t);
        filter.frequency.exponentialRampToValueAtTime(200, t + 0.22);
        gain.gain.setValueAtTime(1.2, t);
        dur = 0.24;
        this.thump(t, 90 + tone * 60, 0.5);
        break;
      case 'place':
        filter.type = 'bandpass';
        filter.frequency.value = 600 + tone * 1200;
        filter.Q.value = 2;
        gain.gain.setValueAtTime(0.8, t);
        dur = 0.06;
        this.thump(t, 140 + tone * 80, 0.35);
        break;
      case 'step':
        filter.type = 'lowpass';
        filter.frequency.value = 500 + tone * 900;
        gain.gain.setValueAtTime(0.18, t);
        dur = 0.06;
        break;
      case 'select':
        filter.type = 'highpass';
        filter.frequency.value = 3000;
        gain.gain.setValueAtTime(0.12, t);
        dur = 0.025;
        break;
    }
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.start(t, Math.random() * 0.3);
    src.stop(t + dur + 0.02);
  }

  private thump(t: number, freq: number, vol: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.5, t + 0.1);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.14);
  }
}
