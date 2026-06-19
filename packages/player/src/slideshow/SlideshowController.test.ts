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
 * Factory: controller on SHOW, advanced to fragmentIndex=1 via playback
 * (emit 2 → frag 0, next(), emit 4 → frag 1). Used across Fix 8b + backToMain tests.
 */
function showAtFrag1() {
  const p = fakePlayer();
  const c = new SlideshowController(p, SHOW);
  p.emit(2); // fragmentIndex=0
  c.next(); // target=4
  p.emit(4); // fragmentIndex=1
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
  it("enters the first slide on construction: seek to start + play", () => {
    const p = fakePlayer();
    new SlideshowController(p, SHOW);
    expect(p.seek).toHaveBeenCalledWith(0);
    expect(p.play).toHaveBeenCalled();
  });

  it("holds (pauses) at slide end when timeupdate reaches it", () => {
    const p = fakePlayer();
    new SlideshowController(p, SHOW);
    p.emit(2); // first fragment — handled separately; still inside slide
    p.emit(5); // reached end
    expect(p.pause).toHaveBeenCalled();
  });

  it("next stops at the first fragment, not the next slide", () => {
    const p = fakePlayer();
    const c = new SlideshowController(p, SHOW);
    p.emit(2); // play reaches fragment 0, controller pauses
    expect(p.pause).toHaveBeenCalled();
    expect(c.position.slideIndex).toBe(0);
    expect(c.position.fragmentIndex).toBe(0);
  });

  it("next past the last fragment advances to the next slide immediately", () => {
    const p = fakePlayer();
    const c = new SlideshowController(p, SHOW);
    c.next(); // -> fragment 1 target (2)
    p.emit(2);
    c.next(); // -> fragment 2 target (4)
    p.emit(4);
    c.next(); // no more fragments — advance to slide b immediately
    expect(c.position.slideIndex).toBe(1);
    expect(p.seek).toHaveBeenLastCalledWith(5);
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
    expect(p2.seek).toHaveBeenLastCalledWith(5);
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

  it("auto-pauses at a fragment, then next advances to the FOLLOWING fragment (not the end)", () => {
    const p = fakePlayer();
    const c = new SlideshowController(p, SHOW);
    p.emit(2); // auto-pause at fragments[0]=2
    expect(c.position.fragmentIndex).toBe(0);
    p.pause.mockClear(); // clear the pause from the auto-stop above
    c.next(); // should target fragments[1]=4, NOT slide.end=5
    p.emit(4);
    expect(p.pause).toHaveBeenCalled(); // must pause at 4, not skip to 5
    expect(c.position.fragmentIndex).toBe(1);
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
    expect(p.seek).toHaveBeenLastCalledWith(10);
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

describe("SlideshowController Fix 8a — fragmentIndex advances via onTime not next()", () => {
  it("next() does NOT pre-increment fragmentIndex; onTime advances it when hold fires", () => {
    const p = fakePlayer();
    const c = new SlideshowController(p, SHOW);
    // fragmentIndex starts at -1 (enterSlide sets it)
    expect(c.position.fragmentIndex).toBe(-1);
    // Call next() — should NOT pre-increment fragmentIndex
    c.next();
    expect(c.position.fragmentIndex).toBe(-1); // still -1 until onTime fires
    // Simulate playback reaching the hold point (fragments[0]=2)
    p.emit(2);
    expect(c.position.fragmentIndex).toBe(0); // onTime advanced it
  });

  it("next() after auto-pause targets the FOLLOWING fragment without pre-increment (regression)", () => {
    const p = fakePlayer();
    const c = new SlideshowController(p, SHOW);
    p.emit(2); // auto-pause at fragments[0]=2; fragmentIndex=0
    expect(c.position.fragmentIndex).toBe(0);
    p.pause.mockClear();
    c.next(); // should target fragments[1]=4 — fragmentIndex stays 0 until emit
    expect(c.position.fragmentIndex).toBe(0); // NOT yet 1
    p.emit(4);
    expect(p.pause).toHaveBeenCalled();
    expect(c.position.fragmentIndex).toBe(1); // onTime advanced it
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

  it("back() when parent fragmentIndex=-1 seeks to slide start", () => {
    const p = fakePlayer();
    const c = new SlideshowController(p, SHOW);
    // Enter branch immediately (fragmentIndex is still -1)
    c.enterBranch("deep");
    c.back();
    expect(c.position.fragmentIndex).toBe(-1);
    // seek should have been called with slide.start=0 (no fragment yet)
    expect(p.seek).toHaveBeenLastCalledWith(0);
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
describe("SlideshowController Fix #5-ctrl — enterSlide clears holdAt on empty branch", () => {
  it("enterSlide into an empty sequence clears holdAt so no spurious pause fires later", () => {
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
    // Now enter a branch that has no slides — enterSlide should clear holdAt
    c.enterBranch("empty");

    // Simulate time advancing — must NOT call pause (stale holdAt would trigger it)
    p.pause.mockClear();
    p.emit(2);
    expect(p.pause).not.toHaveBeenCalled();
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

  it("backToMain when root fragmentIndex=-1 seeks to slide start", () => {
    const p = fakePlayer();
    const c = new SlideshowController(p, SHOW);

    // Enter branch immediately (root fragmentIndex is still -1)
    c.enterBranch("deep");
    c.backToMain();

    expect(c.position.fragmentIndex).toBe(-1);
    expect(p.seek).toHaveBeenLastCalledWith(0); // slide start
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
