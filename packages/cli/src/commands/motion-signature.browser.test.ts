// @vitest-environment happy-dom
// fallow-ignore-file code-duplication
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const script = readFileSync(join(__dirname, "motion-signature.browser.js"), "utf-8");

interface RectInput {
  left: number;
  top: number;
  width: number;
  height: number;
}

type StyleOverride = Partial<CSSStyleDeclaration>;

interface Fixture {
  /** Bounding rects keyed by element id (or lower-case tag name for id-less elements). */
  rects: Record<string, RectInput>;
  /** Computed-style overrides keyed like `rects`; getters are re-read on every call. */
  styles?: Record<string, StyleOverride>;
  /** `::before` / `::after` computed-style overrides keyed like `rects`. */
  pseudo?: Record<string, { before?: StyleOverride; after?: StyleOverride }>;
}

const BASE_STYLE: StyleOverride = {
  display: "block",
  visibility: "visible",
  opacity: "1",
  fontVariationSettings: "normal",
  clipPath: "none",
  counterReset: "none",
  counterIncrement: "none",
  counterSet: "none",
};

const BASE_PSEUDO_STYLE: StyleOverride = {
  content: "none",
  counterReset: "none",
  counterIncrement: "none",
  counterSet: "none",
};

function keyFor(element: Element): string {
  return element.id || element.tagName.toLowerCase();
}

// A per-element fake `getComputedStyle`: each element reports ONLY its own
// declared style, exactly like the real platform (a child of a display:none
// parent still computes display:block). Any ancestor awareness — hidden
// subtrees, counter owners above the root — must therefore come from the
// classifier under test, which is what pins those branches.
function installFixture({ rects, styles = {}, pseudo = {} }: Fixture): void {
  vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudoElement) => {
    const key = keyFor(element as Element);
    if (pseudoElement === "::before" || pseudoElement === "::after") {
      const override = pseudoElement === "::before" ? pseudo[key]?.before : pseudo[key]?.after;
      return { ...BASE_PSEUDO_STYLE, ...override } as CSSStyleDeclaration;
    }
    return { ...BASE_STYLE, ...styles[key] } as CSSStyleDeclaration;
  });
  for (const element of Array.from(document.querySelectorAll("*"))) {
    const input = rects[keyFor(element)] ?? { left: 0, top: 0, width: 0, height: 0 };
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue(rect(input));
  }
}

function rect({ left, top, width, height }: RectInput): DOMRect {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON() {
      return this;
    },
  } as DOMRect;
}

interface SignatureWindow {
  __hyperframesLayoutGeometry: () => string;
  __hyperframesMotionSignature: {
    compositionRoot(): Element;
    compositionSignature(root: Element | null, options?: { quantize?: boolean }): string;
  };
}

function signatureWindow(): SignatureWindow {
  return window as unknown as SignatureWindow;
}

function installScript(): () => string {
  window.eval(script);
  return signatureWindow().__hyperframesLayoutGeometry;
}

function mockMediaPixels(read: () => number): void {
  const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, "getContext") as unknown as {
    mockReturnValue(value: CanvasRenderingContext2D): void;
  };
  getContextSpy.mockReturnValue({
    drawImage() {},
    getImageData() {
      return { data: new Uint8ClampedArray(8 * 8 * 4).fill(read()) };
    },
  } as unknown as CanvasRenderingContext2D);
}

const ROOT = { left: 0, top: 0, width: 640, height: 360 };
const COUNTDOWN = { left: 280, top: 140, width: 80, height: 48 };
const ZERO_BOX = { left: 0, top: 0, width: 0, height: 0 };
const COUNTER_CONSUMER = { after: { content: "counter(countdown)" } };

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  Reflect.deleteProperty(window, "__hyperframesLayoutGeometry");
  Reflect.deleteProperty(window, "__hyperframesMotionSignature");
});

describe("motion-signature.browser media and geometry channels", () => {
  it("changes the sweep fingerprint when visible video pixels advance", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <video id="footage"></video>
      </div>
    `;
    installFixture({ rects: { root: ROOT, footage: ROOT } });
    let pixelValue = 20;
    mockMediaPixels(() => pixelValue);

    const collect = installScript();
    const before = collect();
    pixelValue = 220;

    expect(collect()).not.toBe(before);
  });

  // PRINFRA-666: an equal-size, equal-position opaque <img> src/visibility
  // swap (the authoring pattern for a paused-GSAP-cursor-driven "reveal
  // frame N of a still sequence" composition) moves no geometry and no
  // opacity, so it was invisible to the fingerprint and false-positived
  // sweep_static — mediaPixelHash already existed for exactly this pixel-only
  // motion class, it just wasn't applied to img.
  it("changes the sweep fingerprint when a same-size opaque img is swapped", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <img id="frame" />
      </div>
    `;
    installFixture({ rects: { root: ROOT, frame: ROOT } });
    let pixelValue = 20;
    mockMediaPixels(() => pixelValue);

    const collect = installScript();
    const before = collect();
    pixelValue = 220;

    expect(collect()).not.toBe(before);
  });

  // Opacity-reveal fixture (CLI feedback digest 2026-07-14): code-typing style
  // scenes reveal pre-laid-out characters via opacity only — no geometry ever
  // moves. The sweep fingerprint must treat that as motion, both while a glyph
  // fades (opacity value changes) and when it crosses the 0.2 visibility floor
  // (element enters the signature); otherwise `check` misfires `sweep_static`
  // and authors reach for geometry hacks (a slow host y-drift) to pass.
  it("changes the sweep fingerprint when text reveals via opacity alone", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <div id="code"><span id="char">c</span></div>
      </div>
    `;
    let charOpacity = "0";
    installFixture({
      rects: {
        root: ROOT,
        code: { left: 40, top: 40, width: 560, height: 48 },
        char: { left: 40, top: 40, width: 18, height: 48 },
      },
      styles: {
        char: {
          get opacity() {
            return charOpacity;
          },
        } as StyleOverride,
      },
    });

    const collect = installScript();
    const hidden = collect(); // below the 0.2 visibility floor — not in the signature
    charOpacity = "0.5";
    const fading = collect(); // mid-fade — present, opacity part of the signature
    charOpacity = "1";
    const revealed = collect(); // settled

    expect(fading).not.toBe(hidden);
    expect(revealed).not.toBe(fading);
  });

  // Variable-font axis animation (registry block `weight-wave`): a crest of
  // weight travels across a line of text. In a duplexed face nothing moves
  // but the axis string — the fingerprint must still see it.
  it("changes the sweep fingerprint when only font-variation-settings moves", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <div id="line"><span id="char">P</span></div>
      </div>
    `;
    let axes = '"wght" 400, "slnt" 0';
    installFixture({
      rects: {
        root: ROOT,
        line: { left: 40, top: 40, width: 560, height: 48 },
        char: { left: 40, top: 40, width: 18, height: 48 },
      },
      styles: {
        char: {
          get fontVariationSettings() {
            return axes;
          },
        } as StyleOverride,
      },
    });

    const collect = installScript();
    const rest = collect();
    axes = '"wght" 1000, "slnt" -12'; // the crest arrives over this character

    expect(collect()).not.toBe(rest);
  });

  // The other direction, and it guards the more dangerous failure: a
  // fingerprint that varies on its own would make sweep_static unfireable and
  // every green layout verdict meaningless. Identical scene, axes included,
  // must hash identically.
  it("keeps the sweep fingerprint identical when nothing moves, font axes included", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <div id="line"><span id="char">P</span></div>
      </div>
    `;
    installFixture({
      rects: {
        root: ROOT,
        line: { left: 40, top: 40, width: 560, height: 48 },
        char: { left: 40, top: 40, width: 18, height: 48 },
      },
      styles: { char: { fontVariationSettings: '"wght" 400, "slnt" 0' } },
    });

    const collect = installScript();

    expect(collect()).toBe(collect());
  });

  it("changes the sweep fingerprint when only clip-path moves", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <div id="panel"></div>
      </div>
    `;
    let clipPath = "inset(0px 100% 0px 0px)";
    installFixture({
      rects: { root: ROOT, panel: { left: 40, top: 40, width: 200, height: 100 } },
      styles: {
        panel: {
          get clipPath() {
            return clipPath;
          },
        } as StyleOverride,
      },
    });

    const collect = installScript();
    const before = collect();
    clipPath = "inset(0px 50% 0px 0px)";

    expect(collect()).not.toBe(before);
  });

  it("ignores motion on a data-layout-ignore layer", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <div id="glow" data-layout-ignore></div>
        <span id="countdown">10</span>
      </div>
    `;
    let left = 40;
    installFixture({ rects: { root: ROOT, countdown: COUNTDOWN } });
    vi.spyOn(document.getElementById("glow")!, "getBoundingClientRect").mockImplementation(() =>
      rect({ left, top: 40, width: 100, height: 100 }),
    );

    const collect = installScript();
    const before = collect();
    left = 200;

    expect(collect()).toBe(before);
  });

  it("measures a root that is itself data-layout-ignore while still excluding opted-out layers inside it", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <div id="scene" data-layout-ignore>
          <div id="logo"></div>
          <div id="glow" data-layout-ignore></div>
        </div>
      </div>
    `;
    let logoLeft = 40;
    let glowLeft = 40;
    installFixture({ rects: { root: ROOT, scene: { left: 0, top: 0, width: 300, height: 200 } } });
    vi.spyOn(document.getElementById("logo")!, "getBoundingClientRect").mockImplementation(() =>
      rect({ left: logoLeft, top: 40, width: 50, height: 50 }),
    );
    vi.spyOn(document.getElementById("glow")!, "getBoundingClientRect").mockImplementation(() =>
      rect({ left: glowLeft, top: 40, width: 50, height: 50 }),
    );
    installScript();
    const { compositionSignature } = signatureWindow().__hyperframesMotionSignature;
    const scene = document.getElementById("scene")!;

    const before = compositionSignature(scene);
    expect(before).not.toBe("");
    glowLeft = 200;
    expect(compositionSignature(scene)).toBe(before);
    logoLeft = 200;
    expect(compositionSignature(scene)).not.toBe(before);
  });

  it("buckets sub-threshold moves out of the quantized liveness signature only", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <div id="box"></div>
      </div>
    `;
    let left = 100;
    installFixture({ rects: { root: ROOT } });
    vi.spyOn(document.getElementById("box")!, "getBoundingClientRect").mockImplementation(() =>
      rect({ left, top: 100, width: 50, height: 50 }),
    );
    installScript();
    const { compositionSignature, compositionRoot } =
      signatureWindow().__hyperframesMotionSignature;
    const root = compositionRoot();

    const exactBefore = compositionSignature(root);
    const bucketedBefore = compositionSignature(root, { quantize: true });
    left = 100.6; // moves, but stays inside the 2px liveness bucket

    expect(compositionSignature(root)).not.toBe(exactBefore);
    expect(compositionSignature(root, { quantize: true })).toBe(bucketedBefore);
  });
});

describe("motion-signature.browser textual channels", () => {
  it("changes the sweep fingerprint when fixed-width text content changes", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <span id="countdown">10</span>
      </div>
    `;
    installFixture({ rects: { root: ROOT, countdown: COUNTDOWN } });

    const collect = installScript();
    const before = collect();
    document.getElementById("countdown")!.textContent = "09";

    expect(collect()).not.toBe(before);
  });

  it("ignores text mutations inside a display:none descendant", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <span id="countdown">10<span id="hidden">10</span></span>
      </div>
    `;
    installFixture({
      rects: { root: ROOT, countdown: COUNTDOWN, hidden: COUNTDOWN },
      styles: { hidden: { display: "none" } },
    });

    const collect = installScript();
    const before = collect();
    document.getElementById("hidden")!.textContent = "09";

    expect(collect()).toBe(before);
  });

  it("changes the sweep fingerprint when the composition root's own text changes", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">10</div>
    `;
    installFixture({ rects: { root: ROOT } });

    const collect = installScript();
    const before = collect();
    document.getElementById("root")!.textContent = "09";

    expect(collect()).not.toBe(before);
  });

  it("changes the sweep fingerprint when an attr-backed data value changes", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <span id="countdown" data-txt="10"></span>
      </div>
    `;
    installFixture({
      rects: { root: ROOT, countdown: COUNTDOWN },
      pseudo: {
        countdown: {
          after: {
            // Chromium substitutes attr() in computed pseudo content.
            get content() {
              return JSON.stringify(document.getElementById("countdown")!.getAttribute("data-txt"));
            },
          } as StyleOverride,
        },
      },
    });

    const collect = installScript();
    const before = collect();
    document.getElementById("countdown")!.setAttribute("data-txt", "09");

    expect(collect()).not.toBe(before);
  });

  it("changes the sweep fingerprint when pseudo-element content changes", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <span id="countdown"></span>
      </div>
    `;
    let generatedContent = '"10"';
    installFixture({
      rects: { root: ROOT, countdown: COUNTDOWN },
      pseudo: {
        countdown: {
          after: {
            get content() {
              return generatedContent;
            },
          } as StyleOverride,
        },
      },
    });

    const collect = installScript();
    const before = collect();
    generatedContent = '"09"';

    expect(collect()).not.toBe(before);
  });

  it("changes the sweep fingerprint when checkbox state changes", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <input id="toggle" type="checkbox" />
      </div>
    `;
    installFixture({
      rects: { root: ROOT, toggle: { left: 280, top: 140, width: 24, height: 24 } },
    });

    const collect = installScript();
    const before = collect();
    (document.getElementById("toggle") as HTMLInputElement).checked = true;

    expect(collect()).not.toBe(before);
  });

  it("changes the sweep fingerprint when a checkbox becomes indeterminate", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <input id="toggle" type="checkbox" />
      </div>
    `;
    installFixture({
      rects: { root: ROOT, toggle: { left: 280, top: 140, width: 24, height: 24 } },
    });

    const collect = installScript();
    const before = collect();
    (document.getElementById("toggle") as HTMLInputElement).indeterminate = true;

    expect(collect()).not.toBe(before);
  });

  it("changes the sweep fingerprint when a secondary select option changes", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <select id="choices" multiple><option selected>A</option><option>B</option></select>
      </div>
    `;
    installFixture({
      rects: { root: ROOT, choices: { left: 280, top: 140, width: 120, height: 48 } },
    });

    const collect = installScript();
    const before = collect();
    (document.getElementById("choices") as HTMLSelectElement).options[1]!.selected = true;

    expect(collect()).not.toBe(before);
  });

  it("changes the sweep fingerprint when a fixed-width form value changes", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <input id="countdown" value="10" />
      </div>
    `;
    installFixture({ rects: { root: ROOT, countdown: COUNTDOWN } });

    const collect = installScript();
    const before = collect();
    (document.getElementById("countdown") as HTMLInputElement).value = "09";

    expect(collect()).not.toBe(before);
  });

  it("changes the sweep fingerprint when a textarea value changes", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <textarea id="countdown">10</textarea>
      </div>
    `;
    installFixture({ rects: { root: ROOT, countdown: COUNTDOWN } });

    const collect = installScript();
    const before = collect();
    (document.getElementById("countdown") as HTMLTextAreaElement).value = "09";

    expect(collect()).not.toBe(before);
  });

  it("keeps textual sweep channels identical when the countdown is truly frozen", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <span id="countdown" data-txt="10">10</span>
      </div>
    `;
    installFixture({
      rects: { root: ROOT, countdown: COUNTDOWN },
      styles: { countdown: { counterReset: "countdown 10" } },
      pseudo: { countdown: { after: { content: '"10"' } } },
    });

    const collect = installScript();

    expect(collect()).toBe(collect());
  });
});

describe("motion-signature.browser counter channel", () => {
  it("changes the sweep fingerprint when a zero-box owner's counter state changes", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <div id="counter-owner"><span id="countdown"></span></div>
      </div>
    `;
    let counterReset = "countdown 10";
    installFixture({
      rects: { root: ROOT, "counter-owner": ZERO_BOX, countdown: COUNTDOWN },
      styles: {
        "counter-owner": {
          get counterReset() {
            return counterReset;
          },
        } as StyleOverride,
      },
      pseudo: { countdown: COUNTER_CONSUMER },
    });

    const collect = installScript();
    const before = collect();
    counterReset = "countdown 9";

    expect(collect()).not.toBe(before);
  });

  it("changes the sweep fingerprint when a counter owned above the composition root changes", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <span id="countdown"></span>
      </div>
    `;
    let counterReset = "countdown 10";
    installFixture({
      rects: { root: ROOT, countdown: COUNTDOWN },
      styles: {
        body: {
          get counterReset() {
            return counterReset;
          },
        } as StyleOverride,
      },
      pseudo: { countdown: COUNTER_CONSUMER },
    });

    const collect = installScript();
    const before = collect();
    counterReset = "countdown 9";

    expect(collect()).not.toBe(before);
  });

  it("changes the sweep fingerprint when a pseudo-element's own counter-increment changes", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <span id="countdown"></span>
      </div>
    `;
    let counterIncrement = "countdown 10";
    installFixture({
      rects: { root: ROOT, countdown: COUNTDOWN },
      pseudo: {
        countdown: {
          after: {
            content: "counter(countdown)",
            get counterIncrement() {
              return counterIncrement;
            },
          } as StyleOverride,
        },
      },
    });

    const collect = installScript();
    const before = collect();
    counterIncrement = "countdown 9";

    expect(collect()).not.toBe(before);
  });

  it("changes the sweep fingerprint when a zero-box host's own pseudo-element paints the counter", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <div id="host"></div>
      </div>
    `;
    let counterReset = "countdown 10";
    installFixture({
      rects: { root: ROOT, host: ZERO_BOX },
      styles: {
        body: {
          get counterReset() {
            return counterReset;
          },
        } as StyleOverride,
      },
      pseudo: { host: COUNTER_CONSUMER },
    });

    const collect = installScript();
    const before = collect();
    counterReset = "countdown 9";

    expect(collect()).not.toBe(before);
  });

  it("ignores a zero-box decoy whose counter name nothing paints even when a list marker exists", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <ul><li id="item">item</li></ul>
        <div id="decoy"></div>
      </div>
    `;
    let counterReset = "decoy 10";
    installFixture({
      rects: { root: ROOT, item: COUNTDOWN, decoy: ZERO_BOX },
      styles: {
        item: { display: "list-item" },
        decoy: {
          get counterReset() {
            return counterReset;
          },
        } as StyleOverride,
      },
    });

    const collect = installScript();
    const before = collect();
    counterReset = "decoy 9";

    expect(collect()).toBe(before);
  });

  it("ignores a counter consumed only under a data-layout-ignore layer", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <div id="counter-owner"></div>
        <div data-layout-ignore><span id="countdown"></span></div>
      </div>
    `;
    let counterReset = "countdown 10";
    installFixture({
      rects: { root: ROOT, "counter-owner": ZERO_BOX, countdown: COUNTDOWN },
      styles: {
        "counter-owner": {
          get counterReset() {
            return counterReset;
          },
        } as StyleOverride,
      },
      pseudo: { countdown: COUNTER_CONSUMER },
    });

    const collect = installScript();
    const before = collect();
    counterReset = "countdown 9";

    expect(collect()).toBe(before);
  });

  it("keeps a visibility:hidden owner whose counter feeds a visible consumer", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <div id="counter-owner"><span id="countdown"></span></div>
      </div>
    `;
    let counterReset = "countdown 10";
    installFixture({
      rects: { root: ROOT, "counter-owner": COUNTDOWN, countdown: COUNTDOWN },
      styles: {
        "counter-owner": {
          visibility: "hidden",
          get counterReset() {
            return counterReset;
          },
        } as StyleOverride,
      },
      pseudo: { countdown: COUNTER_CONSUMER },
    });

    const collect = installScript();
    const before = collect();
    counterReset = "countdown 9";

    expect(collect()).not.toBe(before);
  });

  // A display:none element generates no box, so its counters cannot reach any
  // painted counter() — a varying counter-reset there must not make a frozen
  // composition read as live.
  it("ignores a display:none decoy counter owner in a frozen composition", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <div id="decoy"></div>
        <span id="countdown"></span>
      </div>
    `;
    let counterReset = "countdown 10";
    installFixture({
      rects: { root: ROOT, decoy: ZERO_BOX, countdown: COUNTDOWN },
      styles: {
        decoy: {
          display: "none",
          get counterReset() {
            return counterReset;
          },
        } as StyleOverride,
      },
      pseudo: { countdown: COUNTER_CONSUMER },
    });

    const collect = installScript();
    const before = collect();
    counterReset = "countdown 9";

    expect(collect()).toBe(before);
  });

  it("ignores a decoy counter owner nested inside a display:none subtree", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <div id="hidden-parent"><div id="decoy"></div></div>
        <span id="countdown"></span>
      </div>
    `;
    let counterReset = "countdown 10";
    installFixture({
      rects: { root: ROOT, "hidden-parent": ZERO_BOX, decoy: ZERO_BOX, countdown: COUNTDOWN },
      styles: {
        "hidden-parent": { display: "none" },
        // The decoy itself computes display:block — only its ancestry hides it.
        decoy: {
          display: "block",
          get counterReset() {
            return counterReset;
          },
        } as StyleOverride,
      },
      pseudo: { countdown: COUNTER_CONSUMER },
    });

    const collect = installScript();
    const before = collect();
    counterReset = "countdown 9";

    expect(collect()).toBe(before);
  });

  it("ignores counter declarations when no visible generated content consumes a counter", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <div id="counter-owner"></div>
        <span id="countdown">10</span>
      </div>
    `;
    let counterReset = "countdown 10";
    installFixture({
      rects: { root: ROOT, "counter-owner": ZERO_BOX, countdown: COUNTDOWN },
      styles: {
        "counter-owner": {
          get counterReset() {
            return counterReset;
          },
        } as StyleOverride,
      },
    });

    const collect = installScript();
    const before = collect();
    counterReset = "countdown 9";

    expect(collect()).toBe(before);
  });
});
