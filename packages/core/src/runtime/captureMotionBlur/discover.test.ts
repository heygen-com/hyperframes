import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discoverMovers } from "./discover";

// jsdom lays nothing out: each element's rect follows the x its fake timeline writes.
function element(parent: Element, id: string, size = 10, tag = "div"): HTMLElement {
  const el = document.createElement(tag);
  el.id = id;
  parent.append(el);
  el.getBoundingClientRect = () => {
    const x = parseFloat(el.style.transform.replace("translateX(", "")) || 0;
    return { left: x, top: 0, right: x + size, bottom: size, width: size, height: size } as DOMRect;
  };
  return el;
}

function setup() {
  const scene = document.createElement("div");
  const fast = element(scene, "fast");
  const fastChild = element(fast, "fast-child");
  const slow = element(scene, "slow");
  const still = element(scene, "still");
  const off = element(scene, "off");
  off.setAttribute("data-motion-blur", "off");
  // 1 s at 30 fps: `fast` and `off` cross 300 px (10 px/frame), `slow` 15 px (0.5 px/frame).
  const seek = (t: number): void => {
    fast.style.transform = `translateX(${300 * t}px)`;
    fastChild.style.transform = `translateX(${200 * t}px)`;
    slow.style.transform = `translateX(${15 * t}px)`;
    off.style.transform = `translateX(${300 * t}px)`;
  };
  seek(0);
  return { scene, fast, fastChild, slow, still, off, seek };
}

describe("discoverMovers", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps fast, outermost movers that are not opted out", () => {
    const { scene, fast, seek } = setup();
    const { movers } = discoverMovers({ scene, durationSeconds: 1, fps: 30, seek });
    expect(movers).toEqual([fast]);
  });

  // A 100 px jump inside one scan step at 5 s: slow to a still-style baseline, fast between two steps.
  function jumpScene() {
    const scene = document.createElement("div");
    const jumper = element(scene, "jumper");
    const seek = (t: number): void => {
      jumper.style.transform = `translateX(${100 * Math.min(1, Math.max(0, (t - 5) / 0.04))}px)`;
    };
    return { scene, jumper, seek };
  }

  it("finds the same movers whatever time the scan is started at", () => {
    const found = [0, 3, 7].map((start) => {
      const { scene, jumper, seek } = jumpScene();
      seek(start);
      const { movers } = discoverMovers({ scene, durationSeconds: 10, fps: 30, seek });
      return movers.map((m) => m === jumper);
    });
    expect(found).toEqual([[true], [true], [true]]);
  });

  it("does not count an ancestor's pan as a child's move when the child's style first changes", () => {
    // A 100 x 100 camera wrapper pans 1 px/frame; a label inside it fades in at 8 s.
    const scene = document.createElement("div");
    scene.getBoundingClientRect = () => ({ width: 100, height: 100 }) as DOMRect;
    const camera = element(scene, "camera", 100);
    const label = element(camera, "label");
    const x = (el: HTMLElement): number => parseFloat(el.style.transform.slice(11)) || 0;
    label.getBoundingClientRect = () => {
      const left = x(camera) + x(label);
      return { left, top: 0, right: left + 10, bottom: 10, width: 10, height: 10 } as DOMRect;
    };
    const seek = (t: number): void => {
      camera.style.transform = `translateX(${30 * t}px)`;
      label.style.opacity = t < 8 ? "0" : "1";
    };
    seek(0);
    const { movers } = discoverMovers({ scene, durationSeconds: 10, fps: 30, seek });
    expect(movers).toEqual([]);
  });

  it("reports each scan step after its seek, in order, without seeking more", () => {
    const { scene, seek } = setup();
    const events: string[] = [];
    const plain = vi.fn(seek);
    discoverMovers({ scene, durationSeconds: 1, fps: 30, seek: plain });
    const traced = vi.fn((t: number) => {
      events.push(`seek ${t.toFixed(3)}`);
      seek(t);
    });
    discoverMovers({
      scene,
      durationSeconds: 1,
      fps: 30,
      seek: traced,
      onStep: (i, steps) => events.push(`step ${i}/${steps}`),
    });
    expect(traced.mock.calls.length).toBe(plain.mock.calls.length);
    expect(events.slice(0, 4)).toEqual(["seek 0.000", "step 0/30", "seek 0.033", "step 1/30"]);
    expect(events.at(-1)).toBe("step 30/30");
  });

  it("marks every changing element dynamic, slow and opted-out ones included", () => {
    const { scene, fast, fastChild, slow, still, off, seek } = setup();
    const { dynamic } = discoverMovers({ scene, durationSeconds: 1, fps: 30, seek });
    expect(
      dynamic.has(fast) && dynamic.has(fastChild) && dynamic.has(slow) && dynamic.has(off),
    ).toBe(true);
    expect(dynamic.has(still)).toBe(false);
  });

  it("ignores a CSS animation of offset-distance, which the pose has no term for", () => {
    const scene = document.createElement("div");
    const box = document.createElement("div");
    scene.append(box);
    let x = 0; // moves with no inline style change: only getAnimations can nominate it
    box.getBoundingClientRect = () =>
      ({ left: x, right: x + 10, top: 0, bottom: 10, width: 10 }) as DOMRect;
    const scan = (prop: string) => {
      const effect = { target: box, getKeyframes: () => [{ [prop]: "0" }] };
      Object.defineProperty(document, "getAnimations", {
        value: () => [{ effect }],
        configurable: true,
      });
      const seek = (t: number): void => void (x = 300 * t);
      return discoverMovers({ scene, durationSeconds: 1, fps: 30, seek }).movers;
    };
    expect(scan("offsetDistance")).toEqual([]);
    expect(scan("translate")).toEqual([box]);
    Reflect.deleteProperty(document, "getAnimations");
  });

  it("drops a mover in a 3D context, or on an offset-path the pose cannot follow", () => {
    const { scene, fast, seek } = setup();
    const real = window.getComputedStyle;
    let own: object = {};
    vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element) =>
      el === fast
        ? ({ transform: "none", transformStyle: "flat", perspective: "none", ...own } as never)
        : real(el),
    );
    for (own of [
      { transform: "matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)" },
      { offsetPath: "path('M 0 0')" },
    ])
      expect(discoverMovers({ scene, durationSeconds: 1, fps: 30, seek }).movers).toEqual([]);
  });

  it("drops a mover with a 3D rotate axis or a z translate", () => {
    for (const style of [{ rotate: "x 30deg" }, { translate: "1px 2px 3px" }]) {
      const { scene, fast, seek } = setup();
      const real = window.getComputedStyle;
      vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element) =>
        el === fast
          ? ({
              transform: "none",
              transformStyle: "flat",
              perspective: "none",
              ...style,
            } as CSSStyleDeclaration)
          : real(el),
      );
      expect(discoverMovers({ scene, durationSeconds: 1, fps: 30, seek }).movers).toEqual([]);
      vi.restoreAllMocks();
    }
  });

  describe("an element holding more of the scene than it owns", () => {
    // A 100 x 100 scene; `big` is 100 x 100 and slides 10 px/frame, `small` rides inside it.
    function sceneWith(tag = "div") {
      const scene = document.createElement("div");
      scene.getBoundingClientRect = () => ({ width: 100, height: 100 }) as DOMRect;
      const big = element(scene, "big", 100, tag);
      const small = element(big, "small");
      const seek = (t: number): void => {
        big.style.transform = `translateX(${300 * t}px)`;
        small.style.transform = `translateX(${300 * t}px)`;
      };
      seek(0);
      const movers = (): HTMLElement[] =>
        discoverMovers({ scene, durationSeconds: 1, fps: 30, seek }).movers;
      return { big, small, movers };
    }

    it("is no mover when it is a translucent sweep", () => {
      const { big, movers } = sceneWith();
      big.style.opacity = "0.5";
      big.style.backgroundImage = "linear-gradient(90deg, rgba(0, 0, 0, 0), red)";
      expect(movers()).not.toContain(big);
    });

    it("is no mover when its gradient fades to transparent", () => {
      const { big, movers } = sceneWith();
      big.style.backgroundImage = "linear-gradient(90deg, rgba(255, 0, 0, 0), rgb(255, 0, 0))";
      expect(movers()).not.toContain(big);
    });

    it("is no mover when its background colour is see-through", () => {
      const { big, movers } = sceneWith();
      big.style.backgroundColor = "rgba(0, 0, 0, 0.4)";
      expect(movers()).not.toContain(big);
    });

    it("is no mover when it has no paint of its own", () => {
      const { big, movers } = sceneWith();
      expect(movers()).not.toContain(big);
    });

    it("is no mover when it fades", () => {
      const { big, movers } = sceneWith();
      big.style.backgroundColor = "rgb(10, 10, 10)";
      big.style.opacity = "0.6";
      expect(movers()).not.toContain(big);
    });

    it("hands the blur to what it holds", () => {
      const { big, small, movers } = sceneWith();
      big.style.opacity = "0.5";
      expect(movers()).toEqual([small]);
    });

    it("stays a mover when opaque", () => {
      const { big, movers } = sceneWith();
      big.style.backgroundColor = "rgb(10, 10, 10)";
      expect(movers()).toEqual([big]);
    });

    it("stays a mover when it is an opaque gradient", () => {
      const { big, movers } = sceneWith();
      big.style.backgroundImage = "linear-gradient(90deg, rgb(0, 0, 0), rgb(255, 0, 0))";
      expect(movers()).toEqual([big]);
    });

    // jsdom has no canvas: the alpha probe's canvas is faked, `alphas` being the pixels it reads.
    function withImage(tag: "img" | "canvas", alphas: number[] | "tainted") {
      const sc = sceneWith(tag);
      if (tag === "img") {
        Object.defineProperty(sc.big, "complete", { value: true });
        Object.defineProperty(sc.big, "naturalWidth", { value: 1600, configurable: true });
      }
      const draws = vi.fn();
      const realCreate = document.createElement.bind(document);
      vi.spyOn(document, "createElement").mockImplementation((name: string) => {
        if (name !== "canvas") return realCreate(name);
        const ctx = {
          drawImage: draws,
          getImageData: () => {
            if (alphas === "tainted") throw new DOMException("tainted", "SecurityError");
            return { data: Uint8ClampedArray.from(alphas.flatMap((a) => [0, 0, 0, a])) };
          },
        };
        return { getContext: () => ctx } as unknown as HTMLCanvasElement;
      });
      return { ...sc, draws };
    }

    it("stays a mover when it is an opaque image", () => {
      const { big, movers, draws } = withImage("img", [255, 255, 255, 255]);
      expect(movers()).toEqual([big]);
      expect(draws).toHaveBeenCalledTimes(1);
    });

    it("is no mover when it is an image with alpha", () => {
      const { big, movers } = withImage("img", [255, 255, 128, 255]);
      expect(movers()).not.toContain(big);
    });

    it("is no mover when it is a canvas with alpha", () => {
      const { big, movers } = withImage("canvas", [0, 255]);
      expect(movers()).not.toContain(big);
    });

    it("is no mover when its pixels cannot be read", () => {
      const { big, movers } = withImage("img", "tainted");
      expect(movers()).not.toContain(big);
    });

    it("is no mover when the image is not decoded", () => {
      const { big, movers } = withImage("img", [255]);
      Object.defineProperty(big, "naturalWidth", { value: 0, configurable: true });
      expect(movers()).not.toContain(big);
    });

    it("stays a mover when it is a video", () => {
      const { big, movers } = sceneWith("video");
      expect(movers()).toEqual([big]);
    });

    it("stays a mover while it is off screen at zero opacity", () => {
      const { big, movers } = sceneWith();
      big.style.backgroundColor = "rgb(10, 10, 10)";
      big.style.opacity = "0";
      expect(movers()).toEqual([big]);
    });
  });

  it("keeps a small box without paint of its own: its crop matches the background", () => {
    const { scene, fast, seek } = setup();
    scene.getBoundingClientRect = () => ({ width: 100, height: 100 }) as DOMRect;
    fast.style.opacity = "0.5";
    expect(discoverMovers({ scene, durationSeconds: 1, fps: 30, seek }).movers).toEqual([fast]);
  });
});

describe("discoverMovers translationOnly", () => {
  // jsdom resolves no transforms: give computed style the inline matrix, as Chrome's would be.
  beforeEach(() => {
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element) => {
      const cs = real(el);
      return new Proxy(cs, {
        get: (target, key) => {
          if (key === "transform")
            return el instanceof HTMLElement ? el.style.transform || "none" : "none";
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    });
  });
  afterEach(() => vi.restoreAllMocks());

  // The box follows the matrix's x, or `left` when it has no transform.
  function mover(parent: Element, size = 10): HTMLElement {
    const el = document.createElement("div");
    parent.append(el);
    el.getBoundingClientRect = () => {
      const m = /matrix\(([^)]*)\)/.exec(el.style.transform);
      const x = m ? Number(m[1]?.split(",")[4]) : parseFloat(el.style.left) || 0;
      return {
        left: x,
        top: 0,
        right: x + size,
        bottom: size,
        width: size,
        height: size,
      } as DOMRect;
    };
    return el;
  }
  const scan = (scene: HTMLElement, seek: (t: number) => void) => {
    seek(0);
    return discoverMovers({ scene, durationSeconds: 1, fps: 30, seek });
  };

  it("is true when movers only translate, with their own transform", () => {
    const scene = document.createElement("div");
    const el = mover(scene);
    const found = scan(scene, (t) => {
      el.style.transform = `matrix(1, 0, 0, 1, ${300 * t}, 0)`;
    });
    expect(found.movers).toEqual([el]);
    expect(found.translationOnly).toBe(true);
  });

  it("is still true under a parent that scales by a constant", () => {
    const scene = document.createElement("div");
    const wrapper = document.createElement("div");
    wrapper.style.transform = "matrix(1.5, 0, 0, 1.5, 0, 0)";
    scene.append(wrapper);
    const el = mover(wrapper);
    const found = scan(scene, (t) => {
      el.style.transform = `matrix(1, 0, 0, 1, ${300 * t}, 0)`;
    });
    expect(found.translationOnly).toBe(true);
  });

  it("is false when a mover turns or scales while it moves", () => {
    for (const linear of ["rotate", "scale"]) {
      const scene = document.createElement("div");
      const el = mover(scene);
      const found = scan(scene, (t) => {
        const a = linear === "scale" ? 1 + t : Math.cos(t);
        const b = linear === "scale" ? 0 : Math.sin(t);
        el.style.transform = `matrix(${a}, ${b}, ${-b}, ${a}, ${300 * t}, 0)`;
      });
      expect(found.movers).toEqual([el]);
      expect(found.translationOnly).toBe(false);
    }
  });

  it("is false when a mover is moved without a transform, which a filter would re-stack", () => {
    const scene = document.createElement("div");
    const el = mover(scene);
    const found = scan(scene, (t) => {
      el.style.left = `${300 * t}px`;
    });
    expect(found.movers).toEqual([el]);
    expect(found.translationOnly).toBe(false);
  });

  it("is false when nothing moves", () => {
    const scene = document.createElement("div");
    mover(scene);
    expect(scan(scene, () => {}).translationOnly).toBe(false);
  });
});
