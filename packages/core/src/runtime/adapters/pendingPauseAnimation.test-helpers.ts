export class PendingPauseAnimation {
  private timelineMs = 0;
  private startTimeMs = 0;
  private holdTimeMs = 0;
  private pendingPause = false;
  private unresolvedPause: boolean;
  readonly effect: { target: Element } | null;
  readonly calls: string[] = [];
  pauseCalls = 0;
  playState: "running" | "paused" = "running";

  constructor(options: { target?: Element; unresolvedPause?: boolean } = {}) {
    this.effect = options.target ? { target: options.target } : null;
    this.unresolvedPause = options.unresolvedPause ?? false;
  }

  get currentTime(): number | null {
    if (this.unresolvedPause) return null;
    return this.playState === "paused" ? this.holdTimeMs : this.timelineMs - this.startTimeMs;
  }

  set currentTime(timeMs: number) {
    this.calls.push("currentTime");
    this.unresolvedPause = false;
    if (this.pendingPause) {
      this.holdTimeMs = timeMs;
      this.pendingPause = false;
      this.playState = "paused";
    } else if (this.playState === "running") {
      this.startTimeMs = this.timelineMs - timeMs;
    } else {
      this.holdTimeMs = timeMs;
    }
  }

  pause(): void {
    this.calls.push("pause");
    this.pauseCalls++;
    if (this.unresolvedPause) throw new Error("unresolved time");
    if (this.playState === "running") this.pendingPause = true;
  }

  addEventListener(): void {}

  nextFrame(ms = 1000 / 60): void {
    this.timelineMs += ms;
    if (this.pendingPause) {
      this.holdTimeMs = this.timelineMs - this.startTimeMs;
      this.pendingPause = false;
      this.playState = "paused";
    }
  }
}
