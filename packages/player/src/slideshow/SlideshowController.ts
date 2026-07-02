import type { ResolvedSlideshow, ResolvedSlide } from "@hyperframes/core/slideshow";

export interface PlayerPort {
  seek(t: number): void;
  play(): void;
  pause(): void;
  stopMedia?(): void;
  /** Play the `<video>` inside the given scene (for `autoplay` slides). */
  playSceneMedia?(sceneId: string): void;
  readonly currentTime: number;
  onTimeUpdate(cb: (t: number) => void): () => void;
}

interface StackFrame {
  sequenceId: string;
  slideIndex: number;
  fragmentIndex: number; // -1 = before first fragment / at slide start
}

const MAIN = "main";

export class SlideshowController {
  private stack: StackFrame[] = [{ sequenceId: MAIN, slideIndex: 0, fragmentIndex: -1 }];
  private changeCbs = new Set<() => void>();

  constructor(
    private player: PlayerPort,
    private show: ResolvedSlideshow,
  ) {
    this.enterSlide(0);
  }

  // fallow-ignore-next-line unused-class-member
  dispose(): void {
    // No subscriptions to tear down — navigation is seek-driven (see playTo).
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

  private stopSlideMedia(): void {
    this.player.stopMedia?.();
  }

  private enterSlide(index: number): void {
    if (index !== this.frame.slideIndex) this.stopSlideMedia();
    this.frame.slideIndex = index;
    const slide = this.currentSlide;
    if (!slide) {
      this.frame.fragmentIndex = -1;
      return;
    }
    // Jump to the slide's first hold and stay there (no auto-progress). With
    // fragments that's the first fragment (fragmentIndex 0); without, a settled
    // frame INSIDE the slide (its midpoint) — NOT slide.end, which is the boundary
    // where the next scene begins (else slide 1 would render slide 2's content).
    if (slide.fragments.length > 0) {
      this.frame.fragmentIndex = 0;
      this.playTo(slide.fragments[0] ?? slide.end);
    } else {
      this.frame.fragmentIndex = -1;
      this.playTo(this.restFrame(slide));
    }
    // Opt-in: play the slide's own clip on enter (saves a click into the
    // pointer-events:none composition). We never auto-advance — the presenter
    // still clicks Next. Fires from enterSlide (next / prev / goToSlide), NOT
    // from resumeSlide (back / backToMain / syncTo), which restores a saved
    // position; the component also skips it on the audience, which mirrors the
    // presenter's media events rather than driving its own.
    if (slide.autoplay) this.player.playSceneMedia?.(slide.sceneId);
    this.emitChange();
  }

  /** A representative, non-boundary frame for a slide with no fragments. */
  private restFrame(slide: ResolvedSlide): number {
    return slide.start + (slide.end - slide.start) * 0.5;
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
    // Resume position, mirroring enterSlide so going back to a slide lands where
    // entering it forward does:
    //   - at a saved fragment   → that fragment's hold time
    //   - fragmented, pre-first → slide.start (before the first reveal)
    //   - no fragments          → restFrame (midpoint), NOT slide.start, so the
    //     slide is visible at rest instead of frozen at its frame-0 (pre-entrance).
    const seekTime =
      fragmentIndex >= 0 && fragmentIndex < slide.fragments.length
        ? (slide.fragments[fragmentIndex] ?? slide.start)
        : slide.fragments.length > 0
          ? slide.start
          : this.restFrame(slide);
    this.playTo(seekTime);
    this.emitChange();
  }

  /**
   * Jump to hold time `t` and hold there — a pure, synchronous seek with NO
   * sustained playback, so a slide can never auto-progress.
   *
   * `player.seek(t)` drives the composition's GSAP timeline directly (the player
   * reaches the same-origin iframe's `__timelines`), and GSAP `.seek()` renders
   * that frame synchronously AND leaves the timeline paused. So one seek both
   * repaints and holds — deterministically, in every window including a
   * backgrounded one. (The previous play-a-frame-then-pause-on-a-timeupdate
   * "render nudge" left an unfocused audience window playing while it waited for
   * a throttled tick to pause it — that was the auto-progress / one-side-frozen
   * flakiness. fragmentIndex is now set by the caller, not on a played tick.)
   */
  private playTo(t: number): void {
    this.player.seek(t);
  }

  next(): void {
    const slide = this.currentSlide;
    if (!slide) return;
    const hasMoreFragments = this.frame.fragmentIndex + 1 < slide.fragments.length;
    if (hasMoreFragments) {
      // Reveal the next fragment — advance the index and seek to its hold time.
      this.frame.fragmentIndex += 1;
      const target = slide.fragments[this.frame.fragmentIndex] ?? slide.end;
      this.playTo(target);
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
    this.stopSlideMedia();
    this.stack.push({ sequenceId, slideIndex: 0, fragmentIndex: -1 });
    this.enterSlide(0);
  }

  back(): void {
    if (this.stack.length <= 1) return;
    this.stopSlideMedia();
    this.stack.pop();
    // Restore the saved fragmentIndex from the parent frame rather than
    // resetting to -1 (which enterSlide would do). This preserves the exact
    // position the presenter was at before entering the branch.
    this.resumeSlide(this.frame.slideIndex, this.frame.fragmentIndex);
  }

  backToMain(): void {
    if (this.stack.length <= 1) return;
    this.stopSlideMedia();
    this.stack = [this.stack[0]];
    this.resumeSlide(this.frame.slideIndex, this.frame.fragmentIndex);
  }

  /**
   * Jump to an absolute position without animation (audience mirroring).
   * Re-roots the stack to the target sequence, then restores slide+fragment
   * statically via resumeSlide.
   */
  syncTo(sequenceId: string, slideIndex: number, fragmentIndex: number): void {
    if (!this.isValidSyncTarget(sequenceId, slideIndex)) return;
    if (this.isCrossSlide(sequenceId, slideIndex)) this.stopSlideMedia();
    if (!this.rerootStackTo(sequenceId)) return;
    this.resumeSlide(slideIndex, fragmentIndex);
  }

  /** True if the target sequence + slide index resolves to a real slide. */
  private isValidSyncTarget(sequenceId: string, slideIndex: number): boolean {
    if (!this.stack[0]) return false;
    const targetSlides =
      sequenceId === MAIN ? this.show.slides : (this.show.sequences[sequenceId]?.slides ?? null);
    if (!targetSlides) return false;
    return slideIndex >= 0 && slideIndex < targetSlides.length;
  }

  /** True if the sync target lands on a different slide than current. */
  private isCrossSlide(sequenceId: string, slideIndex: number): boolean {
    return this.frame.sequenceId !== sequenceId || this.frame.slideIndex !== slideIndex;
  }

  /**
   * Re-root the navigation stack to `sequenceId` if we're not already there.
   * Returns false only when the target branch sequence is empty (no slides),
   * mirroring the early-return guard in the previous inline form.
   */
  private rerootStackTo(sequenceId: string): boolean {
    if (this.frame.sequenceId === sequenceId) return true;
    const base = this.stack[0];
    if (!base) return false;
    this.stack = [base];
    if (sequenceId === MAIN) return true;
    const seq = this.show.sequences[sequenceId];
    if (!seq || seq.slides.length === 0) return false;
    this.stack.push({ sequenceId, slideIndex: 0, fragmentIndex: -1 });
    return true;
  }
}
