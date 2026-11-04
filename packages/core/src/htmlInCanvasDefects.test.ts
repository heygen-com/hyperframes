import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chromeMajor,
  createDefectScan,
  findCaptureDefect,
  scanBackfaceDefect,
  type DefectEnv,
} from "./htmlInCanvasDefects";

const ua = (major: number | null, headless = false) => ({
  navigator: {
    userAgent:
      major === null
        ? "Mozilla/5.0 HappyDOM"
        : `Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) ${headless ? "HeadlessChrome" : "Chrome"}/${major}.0.0.0 Safari/537.36`,
  },
});

function mount(html: string, rootStyle = ""): HTMLElement {
  document.body.innerHTML = `<div id="root" style="${rootStyle}">${html}</div>`;
  const root = document.getElementById("root");
  if (!root) throw new Error("no root");
  return root;
}

const env = (over: Partial<DefectEnv> = {}): DefectEnv => ({
  isAccelerated: () => false,
  backface: false,
  ...over,
});

const code = (root: HTMLElement, e: DefectEnv) => findCaptureDefect(root, e)?.code ?? null;

/** Every Chrome the render and preview browsers can be, and an unknown one. */
const VERSIONS = [152, 155, 156, 157, 158, null] as const;

/** The defect found with the page's user agent set to `major`. */
function codeOn(major: number | null, root: HTMLElement, e: DefectEnv): string | null {
  const spy = vi
    .spyOn(window.navigator, "userAgent", "get")
    .mockReturnValue(ua(major).navigator.userAgent);
  try {
    return code(root, e);
  } finally {
    spy.mockRestore();
  }
}

afterEach(() => {
  document.body.innerHTML = document.head.innerHTML = "";
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "getAnimations");
});

const animating = (target: Element, frames: object[]) => {
  class Effect {
    target = target;
    getKeyframes = () => frames;
  }
  vi.stubGlobal("KeyframeEffect", Effect);
  Object.assign(document, { getAnimations: () => [{ effect: new Effect() }] });
};

describe("chromeMajor", () => {
  it("reads Chrome and HeadlessChrome, and is null for anything else", () => {
    expect(chromeMajor(ua(152, true))).toBe(152);
    expect(chromeMajor(ua(157))).toBe(157);
    expect(chromeMajor(ua(null))).toBeNull();
  });
});

describe("nested-capture-canvas", () => {
  it("is found on every version, in either API form", () => {
    for (const attr of ["layoutsubtree", 'content="drawable"']) {
      const root = mount(`<canvas ${attr}></canvas>`);
      for (const major of VERSIONS)
        expect(codeOn(major, root, env())).toBe("nested-capture-canvas");
    }
  });
});

describe("accelerated-canvas", () => {
  const gl = (root: HTMLElement) => env({ isAccelerated: (c) => root.contains(c) });

  it("applies on every version, 157 and 158 included", () => {
    const root = mount("<canvas></canvas>");
    for (const major of VERSIONS) {
      expect(codeOn(major, root, gl(root))).toBe("accelerated-canvas");
    }
  });

  it("finds a WebGL canvas outside the root, where a render's shader compositor puts it", () => {
    const root = mount("");
    const outside = document.createElement("canvas");
    document.body.append(outside);
    for (const major of VERSIONS) {
      expect(codeOn(major, root, env({ isAccelerated: (c) => c === outside }))).toBe(
        "accelerated-canvas",
      );
    }
  });

  it("ignores a canvas the page did not give a WebGL context", () => {
    expect(code(mount("<canvas></canvas>"), env())).toBeNull();
  });
});

describe("iframe-in-root", () => {
  it("applies on every version: a reload cannot be undone", () => {
    const root = mount('<div><iframe src="about:blank"></iframe></div>');
    for (const major of VERSIONS) expect(codeOn(major, root, env())).toBe("iframe-in-root");
  });

  it("is not reported for a composition without an iframe", () => {
    expect(code(mount("<div><img></div>"), env())).toBeNull();
  });

  it("also covers <object>, <embed> and defined custom elements, which are re-initialised too", () => {
    customElements.define("x-defect-card", class extends HTMLElement {});
    for (const html of ["<object></object>", "<embed>", "<x-defect-card></x-defect-card>"])
      expect(findCaptureDefect(mount(html), env())).toMatchObject({
        code: "iframe-in-root",
        reason: expect.stringContaining("re-initialised when blur wraps the root"),
      });
    expect(code(mount("<x-defect-undefined></x-defect-undefined>"), env())).toBeNull();
  });

  it("is found by the timeline scan at any step, and says where it first appeared", () => {
    const root = mount("");
    const scan = createDefectScan(root, () => false);
    scan.sample(0, 10, 0);
    root.append(document.createElement("iframe"));
    scan.sample(3, 10, 1.5);
    expect(scan.result()).toMatchObject({ code: "iframe-in-root" });
    expect(scan.result()?.reason).toContain("t=1.5s");
  });
});

describe("facesNow: the scan's candidates, read at the current time", () => {
  it("sees a hidden face flip into 3D after the scan, without rescanning", () => {
    const root = mount('<div id="card" style="backface-visibility: hidden"></div>');
    const scan = createDefectScan(root, () => false);
    scan.sample(0, 10, 0);
    expect(scan.facesNow()).toBe(false);
    const card = document.getElementById("card");
    if (card) card.style.transform = "rotateY(100deg)";
    expect(scan.facesNow()).toBe(true);
    if (card) card.style.transform = "none";
    expect(scan.facesNow()).toBe(false);
  });

  it("takes in a face an animation keys, and keeps it once the animation is gone", () => {
    const root = mount('<div style="transform-style: preserve-3d"><div id="f"></div></div>');
    const face = root.querySelector<HTMLElement>("#f") ?? root;
    const scan = createDefectScan(root, () => false);
    animating(face, [{ backfaceVisibility: "hidden" }]);
    scan.sample(0, 10, 0);
    expect(scan.result()).toBeNull();
    expect(scan.facesNow()).toBe(false);
    // The rule comes after the scan read the sheets: only the animation made the face a candidate.
    document.head.innerHTML = "<style>.hide{backface-visibility:hidden}</style>";
    face.className = "hide";
    expect(scan.facesNow()).toBe(true);
    Object.assign(document, { getAnimations: () => [] });
    scan.sample(10, 10, 1);
    expect(scan.result()?.code).toBe("backface-visibility");
  });

  it("knows only the elements the scan's last face check found", () => {
    const root = mount("");
    const scan = createDefectScan(root, () => false);
    scan.sample(0, 10, 0);
    const late = document.createElement("div");
    late.setAttribute("style", "backface-visibility: hidden; transform: rotateY(100deg)");
    root.append(late);
    expect(scan.facesNow()).toBe(false);
  });
});

describe("root-transform", () => {
  it("applies on every version, 157 and 158 included", () => {
    const root = mount("", "transform: scale(0.5)");
    for (const major of VERSIONS) expect(codeOn(major, root, env())).toBe("root-transform");
  });

  it("ignores a root without a transform", () => {
    expect(code(mount(""), env())).toBeNull();
  });

  it("ignores an identity transform, 2D or 3D, which changes nothing on screen", () => {
    for (const t of [
      "matrix(1, 0, 0, 1, 0, 0)",
      "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)",
    ]) {
      for (const major of VERSIONS)
        expect(codeOn(major, mount("", `transform: ${t}`), env())).toBeNull();
    }
  });

  it("reports a real translate, scale or rotate, 2D or 3D", () => {
    for (const t of [
      "translateX(3px)",
      "scale(1.01)",
      "rotate(1deg)",
      "matrix(1, 0, 0, 1, 0, 2)",
      "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 5, 1)",
    ]) {
      expect(code(mount("", `transform: ${t}`), env())).toBe("root-transform");
    }
  });
});

describe("root individual transform properties and blend mode", () => {
  it("reports a root moved by scale, rotate or translate, not an identity one", () => {
    for (const t of ["scale: 0.5", "rotate: 3deg", "translate: 5px 0"])
      expect(code(mount("", t), env())).toBe("root-transform");
    for (const t of ["scale: 1", "rotate: 0deg", "translate: 0px"])
      expect(code(mount("", t), env())).toBeNull();
  });

  it("reports a root mix-blend-mode other than normal", () => {
    for (const major of VERSIONS)
      expect(codeOn(major, mount("", "mix-blend-mode: multiply"), env())).toBe("root-blend-mode");
    expect(code(mount("", "mix-blend-mode: normal"), env())).toBeNull();
  });
});

describe("root-opacity", () => {
  it("applies on every version, 152 included", () => {
    const root = mount("", "opacity: 0.5");
    for (const major of VERSIONS) expect(codeOn(major, root, env())).toBe("root-opacity");
  });

  it("ignores a fully opaque root", () => {
    expect(code(mount("", "opacity: 1"), env())).toBeNull();
  });
});

describe("no version gating", () => {
  // Mutation guard: a defect that once applied only below 157 (or from 155) must still block on
  // 158 (or 152). Reintroducing any from/until test on the Chrome major fails this.
  it("blocks a WebGL canvas, a root transform and a root fade on every version alike", () => {
    const fixtures: Array<[string, () => HTMLElement, DefectEnv]> = [
      ["accelerated-canvas", () => mount("<canvas></canvas>"), env({ isAccelerated: () => true })],
      ["root-transform", () => mount("", "transform: translateX(5px)"), env()],
      ["root-opacity", () => mount("", "opacity: 0.2"), env()],
    ];
    for (const [expected, build, e] of fixtures) {
      const root = build();
      const seen = new Set(VERSIONS.map((major) => codeOn(major, root, e)));
      expect([...seen]).toEqual([expected]);
    }
  });
});

describe("backface-visibility", () => {
  const face = "backface-visibility: hidden";

  it("is found on every version once the scan saw one", () => {
    const root = mount("");
    for (const major of VERSIONS) {
      expect(codeOn(major, root, env({ backface: true }))).toBe("backface-visibility");
    }
  });

  it("scan: a face inside a preserve-3d card", () => {
    const root = mount(
      `<div style="transform-style: preserve-3d"><div style="${face}"></div></div>`,
    );
    expect(scanBackfaceDefect(root)).toBe(true);
  });

  it("scan: a face turned in 3D by the individual rotate or translate properties", () => {
    for (const own of ["rotate: y 180deg", "rotate: 0 1 0 180deg", "translate: 0 0 10px"])
      expect(scanBackfaceDefect(mount(`<div style="${face}; ${own}"></div>`))).toBe(true);
    expect(scanBackfaceDefect(mount(`<div style="${face}; rotate: 90deg"></div>`))).toBe(false);
  });

  it("scan: a face under a perspective ancestor", () => {
    const root = mount(`<div style="perspective: 800px"><div style="${face}"></div></div>`);
    expect(scanBackfaceDefect(root)).toBe(true);
  });

  it("scan: a face with its own 3D rotation", () => {
    const root = mount(`<div style="${face}; transform: rotateY(180deg)"></div>`);
    expect(scanBackfaceDefect(root)).toBe(true);
  });

  it("scan: the -webkit- spelling counts", () => {
    const root = mount(
      '<div style="transform-style: preserve-3d"><div style="-webkit-backface-visibility: hidden"></div></div>',
    );
    expect(scanBackfaceDefect(root)).toBe(true);
  });

  it("scan: a face found through a stylesheet rule, including inside @media", () => {
    document.head.innerHTML =
      "<style>.card{transform-style:preserve-3d}@media screen{.face{backface-visibility:hidden}}</style>";
    const root = mount('<div class="card"><div class="face"></div></div>');
    expect(scanBackfaceDefect(root)).toBe(true);
  });

  it("scan: the flat performance hack is not a defect", () => {
    document.head.innerHTML = "<style>.perf{backface-visibility:hidden}</style>";
    const root = mount(
      `<div class="perf"></div><div style="${face}; transform: translate3d(0,0,0)"></div>`,
    );
    expect(scanBackfaceDefect(root)).toBe(false);
  });

  it("scan: a 3D card without a hidden face is fine", () => {
    const root = mount('<div style="transform-style: preserve-3d"><div></div></div>');
    expect(scanBackfaceDefect(root)).toBe(false);
  });

  it("scan: a selector that cannot be queried is skipped", () => {
    document.head.innerHTML = "<style>.x::before{backface-visibility:hidden}</style>";
    expect(scanBackfaceDefect(mount("<div class='x'></div>"))).toBe(false);
  });

  it("scan: a 3D context outside the root does not count", () => {
    document.body.innerHTML = `<div style="transform-style: preserve-3d"><div id="root"><div style="${face}"></div></div></div>`;
    const root = document.getElementById("root");
    if (!root) throw new Error("no root");
    expect(scanBackfaceDefect(root)).toBe(false);
  });
});

describe("backface-visibility rules the page reaches indirectly", () => {
  const withProps = (proto: object, props: Record<string, unknown>) =>
    Object.create(
      proto,
      Object.fromEntries(Object.entries(props).map(([k, value]) => [k, { value }])),
    );
  const rule = (selectorText: string, hidden: boolean, cssRules: unknown[] = []) =>
    withProps(CSSStyleRule.prototype, {
      selectorText,
      cssRules,
      style: {
        getPropertyValue: (n: string) => (hidden && n === "backface-visibility" ? "hidden" : ""),
      },
    });
  const imported = (styleSheet: unknown) => withProps(CSSImportRule.prototype, { styleSheet });
  const sheetOf = (...cssRules: unknown[]) => ({ cssRules });
  const realComputed = window.getComputedStyle.bind(window);
  // jsdom computes no style from the stubbed sheets, so `.face` always computes hidden: what is
  // left to prove is that the scan picks the element as a candidate through the sheet.
  const useSheets = (...sheets: unknown[]) => {
    vi.spyOn(document, "styleSheets", "get").mockReturnValue(sheets as never);
    vi.spyOn(window, "getComputedStyle").mockImplementation((el) => {
      const cs = realComputed(el);
      if (!el.classList.contains("face")) return cs;
      return new Proxy(cs, {
        get: (target, key) =>
          key === "getPropertyValue"
            ? (n: string) => (n === "backface-visibility" ? "hidden" : target.getPropertyValue(n))
            : Reflect.get(target, key),
      });
    });
  };
  const card = (inner = '<div class="face"></div>') =>
    mount(`<div class="card" style="transform-style: preserve-3d">${inner}</div>`);

  afterEach(() => vi.restoreAllMocks());

  it("finds a face hidden by a nested rule, with or without &", () => {
    for (const nested of ["& .face", ".face", "&>.face"]) {
      useSheets(sheetOf(rule(".card", false, [rule(nested, true)])));
      expect(scanBackfaceDefect(card())).toBe(true);
    }
  });

  it("resolves a nested rule against its parent: a face elsewhere is not found", () => {
    for (const nested of ["& .face", ".face"]) {
      useSheets(sheetOf(rule(".other", false, [rule(nested, true)])));
      expect(scanBackfaceDefect(card())).toBe(false);
    }
  });

  it("walks nested rules several levels down, and each selector of a nested list", () => {
    useSheets(
      sheetOf(rule(".card", false, [rule(".a, .b", false, [rule("& .face, & .x", true)])])),
    );
    expect(scanBackfaceDefect(card('<div class="a"><div class="face"></div></div>'))).toBe(true);
  });

  it("finds a face hidden by an @imported sheet", () => {
    useSheets(sheetOf(imported(sheetOf(rule(".face", true)))));
    expect(scanBackfaceDefect(card())).toBe(true);
  });

  it("skips an @import that is not loaded or that the page may not read", () => {
    const blocked = {
      get cssRules(): never {
        throw new DOMException("cross-origin", "SecurityError");
      },
    };
    useSheets(sheetOf(imported(null), imported(blocked), rule(".face", true)));
    expect(scanBackfaceDefect(card())).toBe(true);
  });

  it("reads a sheet that imports itself once", () => {
    let reads = 0;
    const loop = {
      get cssRules(): unknown[] {
        reads++;
        return [imported(loop), rule(".face", true)];
      },
    };
    useSheets(loop);
    expect(scanBackfaceDefect(card())).toBe(true);
    expect(reads).toBe(1);
  });

  it("stops following @import chains past a fixed depth", () => {
    let chain = sheetOf(rule(".face", true));
    for (let i = 0; i < 40; i++) chain = sheetOf(imported(chain));
    useSheets(chain);
    expect(scanBackfaceDefect(card())).toBe(false);
  });

  it("finds a face whose backface-visibility comes from @keyframes, named or not yet running", () => {
    document.head.innerHTML = "<style>@keyframes flip{to{backface-visibility:hidden}}</style>";
    useSheets(...Array.from(document.styleSheets));
    const face = (name: string) => card(`<div class="face" style="animation-name: ${name}"></div>`);
    expect(scanBackfaceDefect(face("flip"))).toBe(true);
    expect(scanBackfaceDefect(face("other, flip"))).toBe(true);
    expect(scanBackfaceDefect(face("other"))).toBe(false);
  });

  it("finds a face a running animation keys to hidden, inside the root only", () => {
    const root = card();
    const face = root.querySelector(".face") ?? root;
    const outside = document.body.appendChild(document.createElement("div"));
    outside.className = "face";
    outside.style.transformStyle = "preserve-3d";
    useSheets();
    for (const [frames, el, expected] of [
      [{ backfaceVisibility: "hidden" }, face, true],
      [{ backfaceVisibility: "visible" }, face, false],
      [{ backfaceVisibility: "hidden" }, outside, false],
    ] as const) {
      animating(el, [frames]);
      expect(scanBackfaceDefect(root)).toBe(expected);
    }
  });

  it("still leaves the flat backface hack alone when written as a nested rule", () => {
    useSheets(sheetOf(rule(".card", false, [rule("& .face", true)])));
    expect(scanBackfaceDefect(mount('<div class="card"><div class="face"></div></div>'))).toBe(
      false,
    );
  });
});

describe("order", () => {
  it("reports the first applicable defect", () => {
    const root = mount("<canvas layoutsubtree></canvas>", "opacity: 0.5");
    expect(code(root, env({ backface: true }))).toBe("nested-capture-canvas");
  });
});

describe("createDefectScan", () => {
  const face = "backface-visibility: hidden";
  const run = (root: HTMLElement, steps: number, each?: (i: number) => void) => {
    const scan = createDefectScan(root, () => false);
    for (let i = 0; i <= steps; i++) {
      each?.(i);
      scan.sample(i, steps, i / 10);
    }
    return scan.result();
  };

  it("is clean for a quiet timeline", () => {
    expect(run(mount(""), 20)).toBeNull();
  });

  it("names the defect and when it was first seen", () => {
    const root = mount("");
    const found = run(root, 20, (i) => {
      if (i === 7) root.style.opacity = "0.5";
    });
    expect(found?.code).toBe("root-opacity");
    expect(found?.reason).toContain("first seen at t=0.7s");
  });

  it("sees a rotation that a later step applies to a face with no 3D context at the start", () => {
    const root = mount(`<div id="f" style="${face}"></div>`);
    const el = root.querySelector<HTMLElement>("#f");
    const found = run(root, 20, (i) => {
      if (i === 12 && el) el.style.transform = "rotateY(90deg)";
    });
    expect(found?.code).toBe("backface-visibility");
    expect(found?.reason).toContain("first seen at t=2.0s");
  });

  it("leaves a flat face alone however long the timeline", () => {
    const root = mount(`<div style="${face}; transform: translateX(40px)"></div>`);
    expect(run(root, 40)).toBeNull();
  });
});
