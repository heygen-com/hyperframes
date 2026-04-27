import { describe, it, expect, vi } from "vitest";
import { SceneRunner, animate, delay } from "./generator";

describe("SceneRunner", () => {
  it("builds a timeline sequentially", () => {
    const mockTimeline = {
      to: vi.fn(),
    };

    const runner = new SceneRunner({ timeline: mockTimeline });

    function* myScene() {
      yield animate("box1", { x: 100 }, 1);
      yield delay(0.5);
      yield animate("box2", { opacity: 0 }, 2);
    }

    runner.execute(myScene());

    expect(mockTimeline.to).toHaveBeenCalledTimes(2);
    expect(mockTimeline.to).toHaveBeenNthCalledWith(1, "box1", { x: 100, duration: 1 }, 0);
    expect(mockTimeline.to).toHaveBeenNthCalledWith(2, "box2", { opacity: 0, duration: 2 }, 1.5);
  });

  it("handles non-zero offsetSeconds without double-counting", () => {
    const mockTimeline = {
      to: vi.fn(),
    };

    const runner = new SceneRunner({ timeline: mockTimeline });

    function* myScene() {
      yield animate("a", { x: 0 }, 1); // starts at 0, ends at 1
      yield animate("b", { x: 50 }, 1, 0.5); // offset 0.5 → starts at 1.5, ends at 2.5
      yield animate("c", { x: 100 }, 1); // starts at 2.5 (end of b), ends at 3.5
    }

    runner.execute(myScene());

    expect(mockTimeline.to).toHaveBeenCalledTimes(3);
    // "a": placed at time 0
    expect(mockTimeline.to).toHaveBeenNthCalledWith(1, "a", { x: 0, duration: 1 }, 0);
    // "b": placed at time 1 + 0.5 = 1.5
    expect(mockTimeline.to).toHaveBeenNthCalledWith(2, "b", { x: 50, duration: 1 }, 1.5);
    // "c": placed at time 2.5 (NOT 3.0 — offset must not be double-counted)
    expect(mockTimeline.to).toHaveBeenNthCalledWith(3, "c", { x: 100, duration: 1 }, 2.5);
  });
});
