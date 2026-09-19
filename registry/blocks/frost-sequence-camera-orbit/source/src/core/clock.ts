/** Wall-clock with pause/step support. All systems read `clock.t` and `clock.dt`. */
export const clock = {
  t: 0,
  dt: 1 / 60,
  frame: 0,
  paused: false,
  stepRequested: false,
  _last: performance.now() / 1000,
  tick(now = performance.now() / 1000) {
    const raw = Math.min(0.05, Math.max(0, now - this._last));
    this._last = now;
    if (this.paused && !this.stepRequested) {
      this.dt = 0;
      return;
    }
    this.stepRequested = false;
    this.dt = this.paused ? 1 / 60 : raw;
    this.t += this.dt;
    this.frame++;
  },
};
