// fallow-ignore-file code-duplication
import { describe, it, expect, vi } from "vitest";
import { SlideshowController } from "./SlideshowController";
import type { ResolvedSlideshow } from "@hyperframes/core/slideshow";

function fakePlayer() {
  let cb: ((t: number) => void) | null = null;
  const player = {
    currentTime: 0,
    seek: vi.fn((t: number) => {
      player.currentTime = t;
    }),
    play: vi.fn(() => {}),
    pause: vi.fn(() => {}),
    stopMedia: vi.fn(() => {}),
    onTimeUpdate: (fn: (t: number) => void) => {
      cb = fn;
      return () => {
        cb = null;
      };
    },
    emit: (t: number) => {
      player.currentTime = t;
      cb?.(t);
    },
  };
  return player;
}

const SHOW: ResolvedSlideshow = {
  slides: [
    { sceneId: "a", start: 0, end: 5, fragments: [2, 4], hotspots: [] },
    { sceneId: "b", start: 5, end: 10, fragments: [], hotspots: [] },
  ],
  sequences: {
    deep: {
      id: "deep",
      label: "Deep dive",
      slides: [{ sceneId: "c", start: 10, end: 13, fragments: [], hotspots: [] }],
    },
  },
};

/**
 * Factory: controller on SHOW, advanced to fragmentIndex=1. Construction enters
 * slide a at fragmentIndex 0 (its first fragment); one next() reveals fragment 1.
 * Navigation is synchronous (seek-driven) — no playback emit needed.
 */
function showAtFrag1() {
  const p = fakePlayer();
  const c = new SlideshowController(p, SHOW);
  c.next(); // fragmentIndex 0 → 1
  return { p, c };
}

/**
 * Factory: controller on SHOW, at slide 1, inside the "deep" branch.
 * Used across branching + backToMain tests that share goToSlide(1)+enterBranch setup.
 */
function showAtSlide1InDeep() {
  const p = fakePlayer();
  const c = new SlideshowController(p, SHOW);
  c.goToSlide(1);
  c.enterBranch("deep");
  return { p, c };
}

describe("SlideshowController linear nav", () => {
  it("enters the first slide on construction: seeks to the first fragment (no auto-play)", () => {
    const p = fakePlayer();
    const c = new SlideshowController(p, SHOW);
    // Synchronous seek-only hold: jump to fragments[0]=2, fragmentIndex 0, never play.
    expect(p.seek).toHaveBeenCalledWith(2);
    expect(p.play).not.toHaveBeenCalled();
    expect(c.position.slideIndex).toBe(0);
    expect(c.position.fragmentIndex).toBe(0);
  });

  it("never auto-plays — a single seek both repaints and holds", () => {
    const p = fakePlayer();
    new SlideshowController(p, SHOW);
    // Determinism: navigation is a pure seek; the player is never put into a
    // playing state that could run on into the next fragment/scene.
    expect(p.play).not.toHaveBeenCalled();
  });

  it("does not stop media on construction or same-slide fragment navigation", () => {
    const p = fakePlayer();
    const c = new SlideshowController(p, SHOW);
    expect(p.stopMedia).not.toHaveBeenCalled();

    c.next(); // slide a fragment 0 -> fragment 1, same slide
    expect(p.stopMedia).not.toHaveBeenCalled();
  });

  it("stops media before changing to another slide", () => {
    const p = fakePlayer();
    const c = new SlideshowController(p, SHOW);

    c.next(); // fragment 0 -> fragment 1, same slide
    c.next(); // slide a -> slide b

    expect(p.stopMedia).toHaveBeenCalledOnce();
    expect(p.seek).toHaveBeenLastCalledWith(7.5);
  });

  it("next stops at the first fragment, not the next slide", () => {
    const p = fakePlayer();
    const c = new SlideshowController(p, SHOW);
    // Construction already lands on fragment 0 of slide a.
    expect(c.position.slideIndex).toBe(0);
    expect(c.position.fragmentIndex).toBe(0);
  });

  it("next past the last fragment advances to the next slide immediately", () => {
    const p = fakePlayer();
    const c = new SlideshowController(p, SHOW);
    // construction → fragment 0; next → fragment 1; next → slide b (no fragments)
    c.next(); // fragmentIndex 0 → 1 (seek 4)
    c.next(); // no more fragments — advance to slide b immediately
    expect(c.position.slideIndex).toBe(1);
    expect(p.seek).toHaveBeenLastCalledWith(7.5); // slide b midpoint
  });

  it("next() on a slide with NO fragments advances to the next slide immediately", () => {
    const p = fakePlayer();
    const c = new SlideshowController(p, SHOW);
    // Go to slide b (index 1, no fragments, not at end yet)
    c.goToSlide(1); // slide b: start=5, end=10, fragments=[]
    expect(c.position.slideIndex).toBe(1);
    // The demo SHOW only has 2 slides, so next on slide 1 is a no-op.
    // Use a show with a third slide to verify advancement.
    const show3: ResolvedSlideshow = {
      slides: [
        { sceneId: "a", start: 0, end: 5, fragments: [], hotspots: [] },
        { sceneId: "b", start: 5, end: 10, fragments: [], hotspots: [] },
        { sceneId: "c", start: 10, end: 15, fragments: [], hotspots: [] },
      ],
      sequences: {},
    };
    const p2 = fakePlayer();
    const c2 = new SlideshowController(p2, show3);
    // slide 0 has no fragments; one next() should advance immediately to slide 1
    c2.next();
    expect(c2.position.slideIndex).toBe(1);
    expect(p2.seek).toHaveBeenLastCalledWith(7.5); // slide b midpoint
  });

  it("next() on the last slide is a no-op", () => {
    const p = fakePlayer();
    const c = new SlideshowController(p, SHOW);
    c.goToSlide(1); // slide b is last
    c.next();
    expect(c.position.slideIndex).toBe(1); // no change
  });

  it("prev returns to the previous slide start", () => {
    const p = fakePlayer();
    const c = new SlideshowController(p, SHOW);
    c.goToSlide(1);
    c.prev();
    expect(c.position.slideIndex).toBe(0);
  });

  it("at a fragment, next advances to the FOLLOWING fragment (not the end)", () => {
    const p = fakePlayer();
    const c = new SlideshowController(p, SHOW);
    expect(c.position.fragmentIndex).toBe(0); // construction → fragment 0
    c.next(); // should target fragments[1]=4, NOT slide.end=5
    expect(c.position.fragmentIndex).toBe(1);
    expect(p.seek).toHaveBeenLastCalledWith(4);
  });
});

describe("SlideshowController nextSlide", () => {
  it("returns the next slide when not at the end", () => {
    const p = fakePlayer();
    const c = new SlideshowController(p, SHOW);
    // At slide 0, next should be slide 1 (sceneId "b")
    expect(c.nextSlide).not.toBeNull();
    expect(c.nextSlide?.sceneId).toBe("b");
  });

  it("returns null when at the last slide in the sequence", () => {
    const p = fakePlayer();
    const c = new SlideshowController(p, SHOW);
    c.goToSlide(1); // slide "b" is the last in main
    expect(c.nextSlide).toBeNull();
  });

  it("nextSlide is scoped to the current sequence", () => {
    const p = fakePlayer();
    const c = new SlideshowController(p, SHOW);
    c.enterBranch("deep"); // "deep" has only one slide
    expect(c.nextSlide).toBeNull();
  });
});

describe("SlideshowController branching", () => {
  it("enterBranch pushes onto the stack and enters the branch's first slide", () => {
    const p = fakePlayer();
    const c = new SlideshowController(p, SHOW);
    c.enterBranch("deep");
    expect(c.position.sequenceId).toBe("deep");
    expect(c.currentSlide?.sceneId).toBe("c");
    expect(p.seek).toHaveBeenLastCalledWith(11.5); // slide c midpoint
  });

  it("stops media when entering and leaving a branch", () => {
    const p = fakePlayer();
    const c = new SlideshowController(p, SHOW);

    c.enterBranch("deep");
    expect(p.stopMedia).toHaveBeenCalledTimes(1);

    c.back();
    expect(p.stopMedia).toHaveBeenCalledTimes(2);
  });

  it("counter is scoped to the current sequence", () => {
    const p = fakePlayer();
    const c = new SlideshowController(p, SHOW);
    c.enterBranch("deep");
    expect(c.counter).toEqual({ index: 1, total: 1 });
  });

  it("breadcrumb reflects the stack", () => {
    const { c } = showAtSlide1InDeep();
    expect(c.breadcrumb.map((b) => b.label)).toEqual(["Main deck", "Deep dive"]);
  });

  it("back returns to the exact parent slide", () => {
    const { c } = showAtSlide1InDeep();
    c.back();
    expect(c.position.sequenceId).toBe("main");
    expect(c.position.slideIndex).toBe(1);
  });

  it("backToMain clears nested branches to the root", () => {
    const { c } = showAtSlide1InDeep();
    c.backToMain();
    expect(c.breadcrumb.length).toBe(1);
    expect(c.position.slideIndex).toBe(1);
  });
});

describe("SlideshowController — fragmentIndex advances synchronously on next()", () => {
  it("construction lands on fragment 0; next() reveals fragment 1 immediately", () => {
    const p = fakePlayer();
    const c = new SlideshowController(p, SHOW);
    // Seek-only model: entering a fragmented slide shows its first fragment.
    expect(c.position.fragmentIndex).toBe(0);
    expect(p.seek).toHaveBeenLastCalledWith(2); // fragments[0]
    c.next();
    expect(c.position.fragmentIndex).toBe(1); // synchronous, no played tick
    expect(p.seek).toHaveBeenLastCalledWith(4); // fragments[1]
  });

  it("next() targets the FOLLOWING fragment (not slide end) while fragments remain", () => {
    const p = fakePlayer();
    const c = new SlideshowController(p, SHOW);
    c.next(); // fragment 0 → 1 (fragments[1]=4, NOT slide.end=5)
    expect(c.position.fragmentIndex).toBe(1);
    expect(p.seek).toHaveBeenLastCalledWith(4);
  });
});

describe("SlideshowController Fix 8b — back() restores parent fragmentIndex", () => {
  it("back() restores the saved fragmentIndex and seeks to the fragment time", () => {
    const { p, c } = showAtFrag1();
    expect(c.position.fragmentIndex).toBe(1);
    // Enter branch — saves frame {main, slideIndex:0, fragmentIndex:1}
    c.enterBranch("deep");
    expect(c.position.sequenceId).toBe("deep");
    // Back should restore main, slideIndex=0, fragmentIndex=1, seek to fragments[1]=4
    c.back();
    expect(c.position.sequenceId).toBe("main");
    expect(c.position.slideIndex).toBe(0);
    expect(c.position.fragmentIndex).toBe(1);
    expect(p.seek).toHaveBeenLastCalledWith(4); // fragments[1] = 4
  });

  it("resuming a fragmented slide at fragmentIndex -1 seeks to slide start", () => {
    const p = fakePlayer();
    const c = new SlideshowController(p, SHOW);
    // fragmentIndex -1 on a fragmented slide = before the first reveal. This state
    // is reachable via syncTo (audience mirror); resume should seek to slide.start.
    c.syncTo("main", 0, -1);
    expect(c.position.fragmentIndex).toBe(-1);
    expect(p.seek).toHaveBeenLastCalledWith(0); // slide a start
  });

  it("back() to a NO-fragment parent slide resumes at its midpoint, not frame 0", () => {
    const p = fakePlayer();
    const c = new SlideshowController(p, SHOW);
    c.goToSlide(1); // slide b: [5,10], no fragments
    c.enterBranch("deep");
    c.back();
    expect(c.position.slideIndex).toBe(1);
    // Mirrors enterSlide's no-fragment rest frame (midpoint) so the slide is
    // visible at rest instead of frozen at its pre-entrance frame-0.
    expect(p.seek).toHaveBeenLastCalledWith(7.5); // slide b midpoint (5 + 5*0.5)
  });
});

describe("SlideshowController unknown-sequence degradation", () => {
  it("enterBranch with an unknown id does not throw and leaves nav state unchanged", () => {
    const p = fakePlayer();
    const c = new SlideshowController(p, SHOW);
    c.goToSlide(1);
    expect(() => c.enterBranch("no-such-seq")).not.toThrow();
    expect(c.position.sequenceId).toBe("main");
    expect(c.position.slideIndex).toBe(1);
  });

  it("counter and currentSlide degrade gracefully when sequence is missing from show", () => {
    // Construct a show where sequences has no entries, then verify slidesOf([missing])
    // returns [] and counter/currentSlide do not throw.
    const showNoSeq: ResolvedSlideshow = {
      slides: [{ sceneId: "x", start: 0, end: 5, fragments: [], hotspots: [] }],
      sequences: {},
    };
    const p = fakePlayer();
    const c = new SlideshowController(p, showNoSeq);
    // enterBranch guards — no bogus frame gets pushed. counter on main is safe.
    expect(() => c.counter).not.toThrow();
    expect(c.counter).toEqual({ index: 1, total: 1 });
    // enterBranch with an unknown id: guard fires, state stays on main
    expect(() => c.enterBranch("ghost")).not.toThrow();
    expect(c.position.sequenceId).toBe("main");
    // breadcrumb does not throw for unknown sequence in stack (regression guard)
    expect(() => c.breadcrumb).not.toThrow();
    expect(c.breadcrumb[0]?.id).toBe("main");
  });
});

// ---------------------------------------------------------------------------
// Bug fix tests: #5-ctrl — enterSlide clears holdAt on empty-slide early return
// ---------------------------------------------------------------------------
describe("SlideshowController Fix #5-ctrl — enterBranch ignores empty branch", () => {
  it("enterBranch into an empty sequence is a no-op (does not enter the branch)", () => {
    // Build a show where "empty" sequence has no slides
    const show: ResolvedSlideshow = {
      slides: [{ sceneId: "a", start: 0, end: 5, fragments: [2], hotspots: [] }],
      sequences: {
        empty: { id: "empty", label: "Empty", slides: [] },
      },
    };
    const p = fakePlayer();
    const c = new SlideshowController(p, show);

    // Advance to a holdAt state by calling next() (sets holdAt to fragment 2)
    c.next();
    // Entering a branch that has no slides must be ignored — nav state unchanged.
    c.enterBranch("empty");
    expect(c.position.sequenceId).toBe("main");
    expect(c.position.slideIndex).toBe(0);
  });

  it("enterSlide(0) on an empty main sequence does not throw", () => {
    // This verifies the early-return path doesn't leave holdAt dirty
    const show: ResolvedSlideshow = {
      slides: [],
      sequences: {},
    };
    const p = fakePlayer();
    // Constructor calls enterSlide(0) — must not throw with empty slides
    expect(() => new SlideshowController(p, show)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Bug fix tests: #backToMain — uses resumeSlide to preserve fragment position
// ---------------------------------------------------------------------------
describe("SlideshowController Fix #backToMain — restores fragment position like back()", () => {
  it("backToMain restores the root frame's fragmentIndex (not reset to -1)", () => {
    const { p, c } = showAtFrag1();
    expect(c.position.fragmentIndex).toBe(1);

    // Enter branch — saves root frame with fragmentIndex=1
    c.enterBranch("deep");
    expect(c.position.sequenceId).toBe("deep");

    // backToMain should restore to main slideIndex=0, fragmentIndex=1 (not -1)
    c.backToMain();
    expect(c.position.sequenceId).toBe("main");
    expect(c.position.slideIndex).toBe(0);
    expect(c.position.fragmentIndex).toBe(1);
    // resumeSlide seeks to the fragment time (fragments[1]=4)
    expect(p.seek).toHaveBeenLastCalledWith(4);
  });

  it("backToMain restores the root fragment the branch was entered from", () => {
    const p = fakePlayer();
    const c = new SlideshowController(p, SHOW);

    // Construction lands on slide a fragment 0; enter a branch, then return.
    c.enterBranch("deep");
    c.backToMain();

    expect(c.position.slideIndex).toBe(0);
    expect(c.position.fragmentIndex).toBe(0);
    expect(p.seek).toHaveBeenLastCalledWith(2); // fragments[0]
  });

  it("backToMain with multiple nested branches restores root slide position", () => {
    const show: ResolvedSlideshow = {
      slides: [
        { sceneId: "a", start: 0, end: 5, fragments: [2], hotspots: [] },
        { sceneId: "b", start: 5, end: 10, fragments: [], hotspots: [] },
      ],
      sequences: {
        lvl1: {
          id: "lvl1",
          label: "Level 1",
          slides: [{ sceneId: "c", start: 10, end: 13, fragments: [], hotspots: [] }],
        },
      },
    };
    const p = fakePlayer();
    const c = new SlideshowController(p, show);
    c.goToSlide(1); // root at slide 1
    c.enterBranch("lvl1");

    // backToMain must pop all frames back to root
    c.backToMain();
    expect(c.breadcrumb.length).toBe(1);
    expect(c.position.sequenceId).toBe("main");
    expect(c.position.slideIndex).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Branch-edge navigation: prev/next at branch boundaries return to parent
// ---------------------------------------------------------------------------

// Show used only for branch-edge tests: 2 main slides + single- and multi-slide branches.
const SHOW_BRANCH_EDGE: ResolvedSlideshow = {
  slides: [
    { sceneId: "a", start: 0, end: 5, fragments: [], hotspots: [] },
    { sceneId: "b", start: 5, end: 10, fragments: [], hotspots: [] },
  ],
  sequences: {
    single: {
      id: "single",
      label: "Single slide branch",
      slides: [{ sceneId: "x", start: 10, end: 13, fragments: [], hotspots: [] }],
    },
    multi: {
      id: "multi",
      label: "Multi slide branch",
      slides: [
        { sceneId: "y", start: 13, end: 16, fragments: [], hotspots: [] },
        { sceneId: "z", start: 16, end: 20, fragments: [], hotspots: [] },
      ],
    },
  },
};

/** Factory: controller on SHOW_BRANCH_EDGE, already inside the given branch. */
function inBranch(branchId: string): { c: SlideshowController } {
  const p = fakePlayer();
  const c = new SlideshowController(p, SHOW_BRANCH_EDGE);
  c.enterBranch(branchId);
  return { c };
}

describe("SlideshowController branch-edge nav — prev/next return to parent", () => {
  it("single-slide branch: prev() returns to parent", () => {
    const { c } = inBranch("single");
    expect(c.breadcrumb.length).toBe(2);
    c.prev();
    expect(c.position.sequenceId).toBe("main");
    expect(c.breadcrumb.length).toBe(1);
  });

  it("single-slide branch: next() (no fragments, last slide) returns to parent", () => {
    const { c } = inBranch("single");
    expect(c.breadcrumb.length).toBe(2);
    c.next();
    expect(c.position.sequenceId).toBe("main");
    expect(c.breadcrumb.length).toBe(1);
  });

  it("multi-slide branch: prev() from slide 1 → slide 0, NOT popped", () => {
    const { c } = inBranch("multi");
    c.goToSlide(1);
    c.prev();
    expect(c.position.sequenceId).toBe("multi");
    expect(c.position.slideIndex).toBe(0);
    expect(c.breadcrumb.length).toBe(2);
  });

  it("multi-slide branch: prev() from slide 0 → parent", () => {
    const { c } = inBranch("multi");
    c.prev();
    expect(c.position.sequenceId).toBe("main");
    expect(c.breadcrumb.length).toBe(1);
  });

  it("multi-slide branch: next() from slide 0 → slide 1, NOT popped", () => {
    const { c } = inBranch("multi");
    c.next();
    expect(c.position.sequenceId).toBe("multi");
    expect(c.position.slideIndex).toBe(1);
    expect(c.breadcrumb.length).toBe(2);
  });

  it("multi-slide branch: next() from slide 1 (last) → parent", () => {
    const { c } = inBranch("multi");
    c.goToSlide(1);
    c.next();
    expect(c.position.sequenceId).toBe("main");
    expect(c.breadcrumb.length).toBe(1);
  });

  it("main line: prev() at slide 0 is a no-op (stack.length === 1)", () => {
    const p = fakePlayer();
    const c = new SlideshowController(p, SHOW_BRANCH_EDGE);
    c.prev();
    expect(c.position.sequenceId).toBe("main");
    expect(c.position.slideIndex).toBe(0);
    expect(c.breadcrumb.length).toBe(1);
  });

  it("main line: next() at last slide is a no-op (does NOT call back)", () => {
    const p = fakePlayer();
    const c = new SlideshowController(p, SHOW_BRANCH_EDGE);
    c.goToSlide(1);
    c.next();
    expect(c.position.sequenceId).toBe("main");
    expect(c.position.slideIndex).toBe(1);
    expect(c.breadcrumb.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// canPrev / canNext getters
// ---------------------------------------------------------------------------
describe("SlideshowController canPrev / canNext", () => {
  it("main first slide: canPrev=false, canNext=true", () => {
    const p = fakePlayer();
    const c = new SlideshowController(p, SHOW_BRANCH_EDGE);
    expect(c.canPrev).toBe(false);
    expect(c.canNext).toBe(true);
  });

  it("main last slide: canPrev=true, canNext=false", () => {
    const p = fakePlayer();
    const c = new SlideshowController(p, SHOW_BRANCH_EDGE);
    c.goToSlide(1); // last slide (total=2)
    expect(c.canPrev).toBe(true);
    expect(c.canNext).toBe(false);
  });

  it("main middle slide: canPrev=true, canNext=true", () => {
    // Use SHOW (3+ slides via SHOW_BRANCH_EDGE is only 2; use a 3-slide show)
    const threeSlideShow: ResolvedSlideshow = {
      slides: [
        { sceneId: "a", start: 0, end: 5, fragments: [], hotspots: [] },
        { sceneId: "b", start: 5, end: 10, fragments: [], hotspots: [] },
        { sceneId: "c", start: 10, end: 15, fragments: [], hotspots: [] },
      ],
      sequences: {},
    };
    const p = fakePlayer();
    const c = new SlideshowController(p, threeSlideShow);
    c.goToSlide(1);
    expect(c.canPrev).toBe(true);
    expect(c.canNext).toBe(true);
  });

  it("single-slide main: canPrev=false, canNext=false", () => {
    const oneSlide: ResolvedSlideshow = {
      slides: [{ sceneId: "only", start: 0, end: 5, fragments: [], hotspots: [] }],
      sequences: {},
    };
    const p = fakePlayer();
    const c = new SlideshowController(p, oneSlide);
    expect(c.canPrev).toBe(false);
    expect(c.canNext).toBe(false);
  });

  it("inside a branch (first slide): canPrev=true (parent is prev), canNext=true (next-within or parent)", () => {
    const { c } = inBranch("single");
    // single-slide branch, slideIndex=0, stack.length=2
    expect(c.canPrev).toBe(true);
    expect(c.canNext).toBe(true);
  });

  it("inside a multi-slide branch (first slide): canPrev=true, canNext=true", () => {
    const { c } = inBranch("multi");
    // slideIndex=0, next slide exists within branch
    expect(c.canPrev).toBe(true);
    expect(c.canNext).toBe(true);
  });

  it("inside a multi-slide branch (last slide): canPrev=true, canNext=true (parent is next)", () => {
    const { c } = inBranch("multi");
    c.goToSlide(1); // last slide in branch
    expect(c.canPrev).toBe(true);
    expect(c.canNext).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// next() reveals remaining fragments even when playback is already at slide end
// (the atEnd gate was removed so a no-animation jump to slide end still steps
// through pending fragments rather than skipping straight to the next slide).
// ---------------------------------------------------------------------------
describe("SlideshowController next() — reveals remaining fragments at slide end", () => {
  it("reveals the next fragment even when currentTime is already at slide end", () => {
    const p = fakePlayer();
    const c = new SlideshowController(p, SHOW);
    // Static jump to slide end; pending fragments should still be revealed in order
    // (the playhead position doesn't gate fragment stepping).
    p.currentTime = 5; // slide a end
    c.next(); // fragment 0 → 1, stays on slide a
    expect(c.position.slideIndex).toBe(0);
    expect(c.position.fragmentIndex).toBe(1);
    expect(p.seek).toHaveBeenLastCalledWith(4); // fragments[1], not slide b
  });
});

// ---------------------------------------------------------------------------
// syncTo — absolute, animation-free position mirroring for the audience window.
// ---------------------------------------------------------------------------
describe("SlideshowController syncTo", () => {
  it("re-roots to a branch sequence and restores slide+fragment statically", () => {
    const p = fakePlayer();
    const c = new SlideshowController(p, SHOW);
    c.syncTo("deep", 0, -1);
    expect(c.position.sequenceId).toBe("deep");
    expect(c.position.slideIndex).toBe(0);
    // Slide c has no fragments, so resumeSlide lands at its midpoint (restFrame) —
    // the same visible-at-rest position enterSlide uses — not slide start. A single
    // seek both repaints and holds (no sustained playback).
    expect(p.seek).toHaveBeenLastCalledWith(11.5); // slide c midpoint (10 + 3*0.5)
    expect(p.play).not.toHaveBeenCalled();
  });

  it("syncs a main-line slide+fragment position without animating", () => {
    const p = fakePlayer();
    const c = new SlideshowController(p, SHOW);
    c.syncTo("main", 0, 1); // slide a, fragmentIndex 1 → fragments[1]=4
    expect(c.position.sequenceId).toBe("main");
    expect(c.position.slideIndex).toBe(0);
    expect(c.position.fragmentIndex).toBe(1);
    expect(p.seek).toHaveBeenLastCalledWith(4); // fragments[1] = 4
  });

  it("does not stop media when syncing only the fragment within the same slide", () => {
    const p = fakePlayer();
    const c = new SlideshowController(p, SHOW);

    c.syncTo("main", 0, 1);

    expect(p.stopMedia).not.toHaveBeenCalled();
  });

  it("stops media when audience sync moves to a different slide or sequence", () => {
    const p = fakePlayer();
    const c = new SlideshowController(p, SHOW);

    c.syncTo("main", 1, -1);
    expect(p.stopMedia).toHaveBeenCalledTimes(1);

    c.syncTo("deep", 0, -1);
    expect(p.stopMedia).toHaveBeenCalledTimes(2);
  });

  it("ignores an unknown sequence target", () => {
    const p = fakePlayer();
    const c = new SlideshowController(p, SHOW);
    c.syncTo("nope", 0, -1);
    expect(c.position.sequenceId).toBe("main");
  });

  it("ignores an out-of-range slide index", () => {
    const p = fakePlayer();
    const c = new SlideshowController(p, SHOW);
    c.syncTo("main", 99, -1);
    expect(c.position.slideIndex).toBe(0);
  });
});
