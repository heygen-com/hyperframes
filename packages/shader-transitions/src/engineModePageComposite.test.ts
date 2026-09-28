import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installPageSideCompositor,
  isPageSideCompositingSupported,
  PAGE_COMPOSITOR_BUILD_CANARY,
  PAGE_COMPOSITOR_CANVAS_ID,
} from "./engineModePageComposite.js";

describe("isPageSideCompositingSupported", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns false outside the browser (no window)", () => {
    vi.stubGlobal("window", undefined);
    expect(isPageSideCompositingSupported()).toBe(false);
  });

  it("returns false outside the browser (no document)", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", undefined);
    expect(isPageSideCompositingSupported()).toBe(false);
  });

  it("returns true when drawElementImage and WebGL are both available", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {
      createElement: (tag: string) => {
        if (tag === "canvas") {
          return {
            setAttribute: () => undefined,
            layoutSubtree: true,
            getContext: (type: string) => {
              if (type === "2d") return { drawElementImage: () => undefined };
              if (type === "webgl")
                return { getExtension: () => ({ loseContext: () => undefined }) };
              return null;
            },
          };
        }
        return {};
      },
    });
    expect(isPageSideCompositingSupported()).toBe(true);
  });

  it("returns false when drawElementImage is missing", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {
      createElement: () => ({
        setAttribute: () => undefined,
        getContext: (type: string) =>
          type === "webgl" ? { getExtension: () => ({ loseContext: () => undefined }) } : {},
      }),
    });
    expect(isPageSideCompositingSupported()).toBe(false);
  });

  it("returns false when WebGL is unavailable", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {
      createElement: () => ({
        setAttribute: () => undefined,
        layoutSubtree: true,
        getContext: (type: string) =>
          type === "2d" ? { drawElementImage: () => undefined } : null,
      }),
    });
    expect(isPageSideCompositingSupported()).toBe(false);
  });
});

// A WebGL context whose every call succeeds.
function fakeWebGl(): object {
  return new Proxy(
    {},
    {
      get: (_target, key) => {
        if (key === "getShaderParameter" || key === "getProgramParameter") return () => true;
        if (key === "getExtension") return () => ({ loseContext: () => undefined });
        return () => ({});
      },
    },
  );
}

describe("page-side compositor seek", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  class FakeScene {
    style = { visibility: "hidden" };
    constructor(private readonly attrs: Record<string, string>) {}
    getAttribute(name: string) {
      return this.attrs[name] ?? null;
    }
  }

  // A browser with drawElementImage and a WebGL context whose every call succeeds.
  function installWithHiddenScenes(
    timing: Record<string, readonly [start: string, duration: string]>,
  ) {
    const gl = fakeWebGl();
    const canvas = () => ({
      style: {},
      width: 0,
      height: 0,
      layoutSubtree: true,
      firstChild: null,
      setAttribute: () => undefined,
      remove: () => undefined,
      getContext: (type: string) => (type === "2d" ? { drawElementImage: () => undefined } : gl),
    });
    const scenes = new Map(
      Object.entries(timing).map(([id, [start, duration]]) => [
        id,
        new FakeScene({ "data-start": start, "data-duration": duration }),
      ]),
    );
    let startPolling: (() => void) | undefined;
    const hf = { seek: vi.fn() };
    vi.stubGlobal("window", {
      __hf: hf,
      setInterval: (poll: () => void) => {
        startPolling = poll;
        return 1;
      },
      clearInterval: () => undefined,
    });
    vi.stubGlobal("HTMLElement", FakeScene);
    vi.stubGlobal("document", {
      createElement: canvas,
      getElementById: (id: string) => scenes.get(id) ?? null,
      body: { appendChild: () => undefined },
    });
    const installed = installPageSideCompositor({
      scenes: ["s4", "s5"],
      transitions: [{ time: 4.4, duration: 0.8, shader: "domain-warp" }],
      bgColor: "#000",
      accentColors: { accent: [1, 1, 1], dark: [0, 0, 0], bright: [1, 1, 1] },
      width: 1920,
      height: 1080,
      defaultDuration: 0.8,
    });
    startPolling?.();
    return { installed, hf, scenes };
  }

  // s4 runs 2.8 to 4.8 s, s5 4.4 to 8.0 s; a plain scene plays before and after them.
  const film = { s4: ["2.8", "2"], s5: ["4.4", "3.6"] } as const;

  it("leaves the runtime's hide on a shader scene before its window", () => {
    const { installed, hf, scenes } = installWithHiddenScenes(film);
    expect(installed).toBe(true);
    hf.seek(2.4);
    expect(scenes.get("s4")?.style.visibility).toBe("hidden");
  });

  it("leaves the runtime's hide on the last shader scene after its window", () => {
    const { hf, scenes } = installWithHiddenScenes(film);
    hf.seek(8.8);
    expect(scenes.get("s5")?.style.visibility).toBe("hidden");
  });
});

// The transparent inset case: 640x360 #main holding scenes inset 90px 160px, as in the
// page-side-shader-compositor-render-compat fixture with a transparent page.
describe("page-side compositor scene copies", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // CSS animations the stylesheet gives an element ("::before glow" runs on its pseudo-element),
  // and the live times of those still running.
  const CSS_ANIMATIONS: Record<string, string[]> = {
    stage: ["pulse", "intro", "::before glow", "::before pulse"],
    scene: ["pulse"],
  };
  const LIVE_TIMES: Record<string, Record<string, number>> = {
    stage: { pulse: 400, "::before glow": 250, "::before pulse": 150 },
    scene: { pulse: 900 },
  };

  class FakeAnimation {
    currentTime: number | null = 0;
    state = "running";
    readonly animationName: string;
    readonly effect: { target: FakeEl; pseudoElement: string | null };
    constructor(spec: string, target: FakeEl) {
      const [pseudo, name] = spec.includes(" ") ? spec.split(" ") : [null, spec];
      this.animationName = name!;
      this.effect = { target, pseudoElement: pseudo ?? null };
    }
    pause() {
      this.state = "paused";
    }
    cancel() {
      this.state = "cancelled";
    }
  }

  class FakeEl {
    style: Record<string, string> = {};
    children: FakeEl[] = [];
    parentElement: FakeEl | null = null;
    animations: FakeAnimation[] = [];
    constructor(
      readonly id: string,
      readonly copyOf: FakeEl | null = null,
    ) {}
    getAttribute() {
      return null;
    }
    get key(): string {
      return (this.copyOf ?? this).id.replace(/^scene-.*/, "scene");
    }
    ownAnimations(): FakeAnimation[] {
      if (this.copyOf) return this.animations;
      return Object.entries(LIVE_TIMES[this.key] ?? {}).map(([spec, time]) => {
        const live = new FakeAnimation(spec, this);
        live.currentTime = time;
        return live;
      });
    }
    getAnimations(options?: { subtree?: boolean }): FakeAnimation[] {
      if (!options?.subtree) return this.ownAnimations();
      return [...this.ownAnimations(), ...this.children.flatMap((c) => c.getAnimations(options))];
    }
    cloneNode(deep: boolean) {
      const copy = new FakeEl(`${this.id}-copy`, this);
      copy.animations = (CSS_ANIMATIONS[this.key] ?? []).map(
        (spec) => new FakeAnimation(spec, copy),
      );
      if (deep) copy.children = this.children.map((c) => c.cloneNode(true));
      return copy;
    }
    appendChild(child: FakeEl) {
      this.children.push(child);
      child.parentElement = this;
      return child;
    }
    querySelectorAll() {
      return [];
    }
  }

  function installTransparentInsetFilm(opts: { failDraw?: boolean; underBody?: boolean } = {}) {
    const calls: Array<{ canvas: number; op: string; args: unknown[] }> = [];
    const gl = new Proxy(fakeWebGl(), {
      get: (target, key) => {
        if (key === "texImage2D") {
          return (...args: unknown[]) => calls.push({ canvas: -1, op: "texImage2D", args });
        }
        return Reflect.get(target, key);
      },
    });
    const canvases: Array<{ id?: string; style: Record<string, string> }> = [];
    const createCanvas = () => {
      const index = canvases.length;
      const children: FakeEl[] = [];
      const record =
        (op: string) =>
        (...args: unknown[]) => {
          calls.push({ canvas: index, op, args });
          if (op === "drawElementImage" && opts.failDraw) throw new Error("No cached paint record");
        };
      const ctx = {
        fillStyle: "",
        fillRect: record("fillRect"),
        clearRect: record("clearRect"),
        drawElementImage: record("drawElementImage"),
      };
      const canvas: { id?: string; style: Record<string, string>; [key: string]: unknown } = {
        style: {},
        width: 0,
        height: 0,
        layoutSubtree: true,
        setAttribute: () => undefined,
        remove: () => undefined,
        get firstChild() {
          return children[0] ?? null;
        },
        get firstElementChild() {
          return children[0] ?? null;
        },
        appendChild: (child: FakeEl) => children.push(child),
        removeChild: () => children.shift(),
        querySelectorAll: () => [],
        getContext: (type: string) => (type === "2d" ? ctx : gl),
      };
      canvases.push(canvas);
      return canvas;
    };
    const body = new FakeEl("body");
    // An unsized wrapper between the composition root and the scenes, as in authored films.
    const parent = opts.underBody
      ? body
      : body.appendChild(new FakeEl("main")).appendChild(new FakeEl("stage"));
    const scenes = new Map([
      ["scene-a", parent.appendChild(new FakeEl("scene-a"))],
      ["scene-b", parent.appendChild(new FakeEl("scene-b"))],
    ]);
    let startPolling: (() => void) | undefined;
    const hf = { seek: vi.fn() };
    const win: Record<string, unknown> = {
      __hf: hf,
      setInterval: (poll: () => void) => {
        startPolling = poll;
        return 1;
      },
      clearInterval: () => undefined,
    };
    vi.stubGlobal("window", win);
    vi.stubGlobal("HTMLElement", FakeEl);
    vi.stubGlobal("document", {
      createElement: (tag: string) => (tag === "canvas" ? createCanvas() : new FakeEl(tag)),
      getElementById: (id: string) => scenes.get(id) ?? null,
      body,
      documentElement: null,
    });
    installPageSideCompositor({
      scenes: ["scene-a", "scene-b"],
      transitions: [{ time: 0.75, duration: 0.85, shader: "glitch" }],
      bgColor: "transparent",
      accentColors: { accent: [1, 1, 1], dark: [0, 0, 0], bright: [1, 1, 1] },
      width: 640,
      height: 360,
      defaultDuration: 0.85,
    });
    startPolling?.();
    const composite = async (time: number) => {
      hf.seek(time);
      await (win.__hf_page_composite_prepare as () => Promise<boolean>)();
      return (win.__hf_page_composite_resolve as () => boolean)();
    };
    const overlay = () => canvases.find((c) => c.id === PAGE_COMPOSITOR_CANVAS_ID)!;
    return { calls, composite, overlay };
  }

  it("stages each scene copy inside unaltered ancestor copies in a full-frame box", async () => {
    const { calls, composite } = installTransparentInsetFilm();
    expect(await composite(1.2)).toBe(true);
    const draws = calls.filter((c) => c.op === "drawElementImage");
    expect(draws).toHaveLength(2);
    for (const [index, sceneId] of [
      [0, "scene-a"],
      [1, "scene-b"],
    ] as const) {
      const frame = draws[index]?.args[0] as FakeEl;
      expect(draws[index]?.args.slice(1)).toEqual([0, 0, 640, 360]);
      expect(frame.style.cssText).toContain("width:640px;height:360px");
      const main = frame.children[0]!;
      const stage = main.children[0]!;
      const scene = stage.children[0]!;
      expect([main, stage, scene].map((el) => el.copyOf?.id)).toEqual(["main", "stage", sceneId]);
      expect(main.style).toEqual({});
      expect(stage.style).toEqual({});
      expect(scene.style).toEqual({ opacity: "1", visibility: "visible" });
    }
  });

  it("holds copied CSS animations at the live time and cancels ones finished live", async () => {
    const { calls, composite } = installTransparentInsetFilm();
    await composite(1.2);
    const frame = calls.find((c) => c.op === "drawElementImage")?.args[0] as FakeEl;
    const stage = frame.children[0]!.children[0]!;
    const [pulse, intro, glow, pseudoPulse] = stage.animations;
    expect(pulse).toMatchObject({ animationName: "pulse", state: "paused", currentTime: 400 });
    expect(intro).toMatchObject({ animationName: "intro", state: "cancelled" });
    expect(glow).toMatchObject({ animationName: "glow", state: "paused", currentTime: 250 });
    // The same name on the stage's ::before and on the scene keeps each one's own time.
    expect(pseudoPulse).toMatchObject({ state: "paused", currentTime: 150 });
    expect(stage.children[0]!.animations[0]).toMatchObject({ state: "paused", currentTime: 900 });
  });

  it("stages a scene directly under body in the full-frame box", async () => {
    const { calls, composite } = installTransparentInsetFilm({ underBody: true });
    expect(await composite(1.2)).toBe(true);
    const draws = calls.filter((c) => c.op === "drawElementImage");
    for (const draw of draws) {
      const frame = draw.args[0] as FakeEl;
      expect(frame.children.map((c) => c.copyOf?.id.slice(0, 5))).toEqual(["scene"]);
      expect(draw.args.slice(1)).toEqual([0, 0, 640, 360]);
    }
  });

  it("clears both staging bitmaps after the textures are uploaded", async () => {
    const { calls, composite } = installTransparentInsetFilm();
    await composite(1.2);
    const lastUpload = calls.map((c) => c.op).lastIndexOf("texImage2D");
    const staging = new Set(calls.filter((c) => c.op === "drawElementImage").map((c) => c.canvas));
    expect(staging.size).toBe(2);
    for (const canvas of staging) {
      const lastClear = Math.max(
        ...calls.flatMap((c, n) => (c.canvas === canvas && c.op === "clearRect" ? [n] : [])),
      );
      expect(lastClear).toBeGreaterThan(lastUpload);
      const drawn = calls.findIndex((c) => c.canvas === canvas && c.op === "drawElementImage");
      const clearedBeforeUpload = calls.some(
        (c, n) => c.canvas === canvas && c.op === "clearRect" && n > drawn && n < lastUpload,
      );
      expect(clearedBeforeUpload).toBe(false);
    }
  });

  it("clears the staging bitmaps and hides the overlay when a scene capture fails", async () => {
    const { calls, composite, overlay } = installTransparentInsetFilm({ failDraw: true });
    expect(await composite(1.2)).toBe(false);
    const drawn = calls.find((c) => c.op === "drawElementImage")?.canvas;
    expect(calls.some((c) => c.canvas === drawn && c.op === "clearRect")).toBe(true);
    expect(overlay().style.display).toBe("none");
  });
});

describe("page-side compositor exported constants", () => {
  it("exports a stable canary string used by the bundled-CLI smoke", () => {
    expect(PAGE_COMPOSITOR_BUILD_CANARY).toBe("__hf_page_compositor_v1__");
  });

  it("exports a stable canvas id", () => {
    expect(PAGE_COMPOSITOR_CANVAS_ID).toBe("__hf-page-side-compositor");
  });
});
