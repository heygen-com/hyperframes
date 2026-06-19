import type { ResolvedSlideshow, ResolvedSlide } from "@hyperframes/core/slideshow";

export interface PlayerPort {
  seek(t: number): void;
  play(): void;
  pause(): void;
  readonly currentTime: number;
  onTimeUpdate(cb: (t: number) => void): () => void;
}

interface StackFrame {
  sequenceId: string;
  slideIndex: number;
  fragmentIndex: number; // -1 = before first fragment / at slide start
}

const MAIN = "main";
const EPS = 0.001;
// Seconds to play past a restored/mirrored position so the composition repaints
// (a bare paused seek doesn't re-render some compositions; pausing on the first
// timeupdate fires before a paint).
const RENDER_NUDGE = 0.2;

export class SlideshowController {
  private stack: StackFrame[] = [{ sequenceId: MAIN, slideIndex: 0, fragmentIndex: -1 }];
  private holdAt: number | null = null;
  private changeCbs = new Set<() => void>();
  private unsub: () => void;

  constructor(
    private player: PlayerPort,
    private show: ResolvedSlideshow,
  ) {
    this.unsub = player.onTimeUpdate((t) => this.onTime(t));
    this.enterSlide(0);
  }

  // fallow-ignore-next-line unused-class-member
  dispose(): void {
    this.unsub();
  }

  private slidesOf(sequenceId: string): ResolvedSlide[] {
    if (sequenceId === MAIN) return this.show.slides;
    return this.show.sequences[sequenceId]?.slides ?? [];
  }

  private get frame(): StackFrame {
    return this.stack[this.stack.length - 1];
  }

  get currentSlide(): ResolvedSlide | undefined {
    return this.slidesOf(this.frame.sequenceId)[this.frame.slideIndex];
  }

  get nextSlide(): ResolvedSlide | null {
    const slides = this.slidesOf(this.frame.sequenceId);
    const next = slides[this.frame.slideIndex + 1];
    return next ?? null;
  }

  get position(): { sequenceId: string; slideIndex: number; fragmentIndex: number } {
    return { ...this.frame };
  }

  get counter(): { index: number; total: number } {
    return {
      index: this.frame.slideIndex + 1,
      total: this.slidesOf(this.frame.sequenceId).length,
    };
  }

  get canPrev(): boolean {
    // prev has a destination: an earlier slide in this sequence, OR (in a branch) the parent.
    return this.frame.slideIndex > 0 || this.stack.length > 1;
  }

  get canNext(): boolean {
    // next has a destination: a later slide in this sequence, OR (in a branch) the parent.
    const slides = this.slidesOf(this.frame.sequenceId);
    return this.frame.slideIndex + 1 < slides.length || this.stack.length > 1;
  }

  get breadcrumb(): { id: string; label: string }[] {
    return this.stack.map((f) =>
      f.sequenceId === MAIN
        ? { id: MAIN, label: "Main deck" }
        : { id: f.sequenceId, label: this.show.sequences[f.sequenceId]?.label ?? f.sequenceId },
    );
  }

  // fallow-ignore-next-line unused-class-member
  onChange(cb: () => void): () => void {
    this.changeCbs.add(cb);
    return () => this.changeCbs.delete(cb);
  }

  private emitChange(): void {
    for (const cb of this.changeCbs) cb();
  }

  private enterSlide(index: number): void {
    this.frame.slideIndex = index;
    this.frame.fragmentIndex = -1;
    this.holdAt = null;
    const slide = this.currentSlide;
    if (!slide) return;
    // Jump to the slide's first hold (its first fragment, or the built end-state
    // when it has none). playTo() seeks rather than sustaining playback, so the
    // slide does NOT auto-progress — it shows a static frame and waits.
    this.playTo(this.nextStop(slide, -1));
    this.emitChange();
  }

  /**
   * Resumes a slide at a saved fragmentIndex without resetting to slide start.
   * Used by back()/backToMain()/syncTo() to restore an exact position.
   */
  private resumeSlide(index: number, fragmentIndex: number): void {
    this.frame.slideIndex = index;
    this.frame.fragmentIndex = fragmentIndex;
    const slide = this.currentSlide;
    if (!slide) return;
    // Seek to the fragment's hold time (or slide start if before any fragment).
    const seekTime =
      fragmentIndex >= 0 && fragmentIndex < slide.fragments.length
        ? (slide.fragments[fragmentIndex] ?? slide.start)
        : slide.start;
    this.holdAt = null;
    this.playTo(seekTime);
    this.emitChange();
  }

  private nextStop(slide: ResolvedSlide, fragmentIndex: number): number {
    const next = slide.fragments[fragmentIndex + 1];
    return next ?? slide.end;
  }

  /**
   * Jump to hold time `t` and pause there — NO sustained playback, so slides
   * never auto-progress. Seeks just before `t` and plays a short render-nudge
   * ending at `t`: a bare paused seek doesn't repaint some compositions, and
   * pausing on the first timeupdate fires before a paint. onTime() pauses at `t`
   * and advances fragmentIndex when `t` is a fragment boundary.
   */
  private playTo(t: number): void {
    this.holdAt = t;
    this.player.seek(Math.max(0, t - RENDER_NUDGE));
    this.player.play();
  }

  private onTime(t: number): void {
    if (this.holdAt !== null && t >= this.holdAt - EPS) {
      const hold = this.holdAt;
      this.holdAt = null;
      // Advance fragmentIndex if this hold is a fragment boundary.
      const slide = this.currentSlide;
      if (slide) {
        const fragIdx = slide.fragments.indexOf(hold);
        if (fragIdx !== -1) {
          this.frame.fragmentIndex = fragIdx;
          this.emitChange();
        }
      }
      this.player.pause();
    }
  }

  next(): void {
    const slide = this.currentSlide;
    if (!slide) return;
    const hasMoreFragments = this.frame.fragmentIndex + 1 < slide.fragments.length;
    if (hasMoreFragments) {
      // Reveal the next fragment. onTime() advances fragmentIndex at the hold.
      const nextTarget = this.nextStop(slide, this.frame.fragmentIndex);
      this.playTo(nextTarget);
      this.emitChange();
      return;
    }
    // No more fragments to reveal — advance to the next slide immediately instead of
    // playing the current slide out to its end.
    const slides = this.slidesOf(this.frame.sequenceId);
    if (this.frame.slideIndex + 1 < slides.length) {
      this.enterSlide(this.frame.slideIndex + 1);
    } else if (this.stack.length > 1) {
      // End of a branch → return to the parent timeline.
      this.back();
    }
  }

  prev(): void {
    if (this.frame.slideIndex > 0) {
      this.enterSlide(this.frame.slideIndex - 1);
      return;
    }
    if (this.stack.length > 1) {
      // First slide of a branch → return to the parent timeline.
      this.back();
    }
  }

  goToSlide(index: number): void {
    const slides = this.slidesOf(this.frame.sequenceId);
    if (index >= 0 && index < slides.length) this.enterSlide(index);
  }

  enterBranch(sequenceId: string): void {
    const seq = this.show.sequences[sequenceId];
    if (!seq || seq.slides.length === 0) return;
    this.stack.push({ sequenceId, slideIndex: 0, fragmentIndex: -1 });
    this.enterSlide(0);
  }

  back(): void {
    if (this.stack.length <= 1) return;
    this.stack.pop();
    // Restore the saved fragmentIndex from the parent frame rather than
    // resetting to -1 (which enterSlide would do). This preserves the exact
    // position the presenter was at before entering the branch.
    this.resumeSlide(this.frame.slideIndex, this.frame.fragmentIndex);
  }

  backToMain(): void {
    if (this.stack.length <= 1) return;
    this.stack = [this.stack[0]];
    this.resumeSlide(this.frame.slideIndex, this.frame.fragmentIndex);
  }

  /**
   * Jump to an absolute position without animation (audience mirroring).
   * Re-roots the stack to the target sequence, then restores slide+fragment
   * statically via resumeSlide.
   */
  syncTo(sequenceId: string, slideIndex: number, fragmentIndex: number): void {
    const base = this.stack[0];
    if (!base) return;
    if (this.frame.sequenceId !== sequenceId) {
      this.stack = [base];
      if (sequenceId !== MAIN) {
        const seq = this.show.sequences[sequenceId];
        if (!seq || seq.slides.length === 0) return;
        this.stack.push({ sequenceId, slideIndex: 0, fragmentIndex: -1 });
      }
    }
    const slides = this.slidesOf(this.frame.sequenceId);
    if (slideIndex < 0 || slideIndex >= slides.length) return;
    this.resumeSlide(slideIndex, fragmentIndex);
  }
}
