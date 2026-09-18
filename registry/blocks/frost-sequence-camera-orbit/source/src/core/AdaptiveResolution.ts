/**
 * Keeps the render workload inside a frame budget by changing only pixel density. Effects,
 * simulation rates and scene content stay untouched. Adjustments are quantised and hysteretic so
 * render targets are not continually resized around the target frame rate.
 */
export class AdaptiveResolution {
  private ratio = 0;
  private frameMs = 0;
  private frames = 0;
  private lastAdjust = 0;

  update(
    now: number,
    elapsedMs: number,
    deviceRatio: number,
    cap: number,
    enabled: boolean,
    targetFps: number,
    minimum: number,
  ) {
    const maximum = Math.max(0.5, Math.min(deviceRatio || 1, cap));
    const minRatio = Math.min(maximum, Math.max(0.5, minimum));
    if (!this.ratio || !enabled) this.ratio = maximum;
    this.ratio = Math.min(maximum, Math.max(minRatio, this.ratio));

    // Clip one-off shader compilation/rebuild stalls before feeding the controller.
    const sample = Math.min(50, Math.max(1, elapsedMs));
    this.frameMs = this.frames === 0 ? sample : this.frameMs + (sample - this.frameMs) * 0.08;
    this.frames++;
    if (!enabled || this.frames < 45 || now - this.lastAdjust < 0.5) return this.ratio;

    const budget = 1000 / Math.max(30, targetFps);
    let next = this.ratio;
    if (this.frameMs > budget * 1.08 && this.ratio > minRatio) {
      const ideal = this.ratio * Math.sqrt(budget / this.frameMs) * 0.98;
      next = Math.min(this.ratio - 0.05, ideal);
      next = Math.floor(next * 20) / 20;
    } else if (this.frameMs < budget * 0.82 && this.ratio < maximum) {
      next = Math.ceil((this.ratio + 0.05) * 20) / 20;
    }
    next = Math.min(maximum, Math.max(minRatio, next));
    if (next !== this.ratio) {
      this.ratio = next;
      // Give the resized render targets time to establish their new steady-state cost.
      this.frameMs = budget;
      this.lastAdjust = now;
    }
    return this.ratio;
  }

  /**
   * Plans a split-resolution frame. `sourceRatio` is the effective DPR paid by the scene pass;
   * `outputRatio` is the canvas/final-post DPR. With split output disabled they are identical,
   * which preserves the previous whole-frame scaling path for comparison and fallback.
   */
  updateScene(
    now: number,
    elapsedMs: number,
    deviceRatio: number,
    outputCap: number,
    enabled: boolean,
    targetFps: number,
    minPixelRatio: number,
    maxSceneScale: number,
    minSceneScale: number,
    splitOutput: boolean,
  ) {
    const nativeRatio = Math.max(0.5, Math.min(deviceRatio || 1, outputCap));
    const maxScale = Math.max(0.25, Math.min(1, maxSceneScale));
    const sourceMaximum = Math.max(0.5, nativeRatio * maxScale);
    const relativeMinimum = nativeRatio * Math.max(0.25, Math.min(maxScale, minSceneScale));
    const sourceMinimum = Math.min(sourceMaximum, Math.max(0.5, minPixelRatio, relativeMinimum));
    const sourceRatio = this.update(
      now,
      elapsedMs,
      sourceMaximum,
      sourceMaximum,
      enabled,
      targetFps,
      sourceMinimum,
    );
    const outputRatio = splitOutput ? nativeRatio : sourceRatio;
    return {
      sourceRatio,
      outputRatio,
      sceneScale: splitOutput ? sourceRatio / nativeRatio : 1,
    };
  }
}
