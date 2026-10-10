/**
 * One Euro filter (Casiez et al. 2012): heavy smoothing when still, low lag when
 * moving fast. Time in seconds.
 */
export class OneEuro {
  private x = 0;
  private dx = 0;
  private t = -1;

  constructor(
    public minCutoff = 1.0,
    public beta = 0.02,
    public dCutoff = 1.0,
  ) {}

  private static alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  reset() {
    this.t = -1;
  }

  filter(value: number, t: number) {
    if (this.t < 0) {
      this.t = t;
      this.x = value;
      this.dx = 0;
      return value;
    }
    const dt = Math.max(1e-3, t - this.t);
    this.t = t;
    const rawDx = (value - this.x) / dt;
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuro.alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}
