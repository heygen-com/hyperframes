// @vitest-environment happy-dom
// fallow-ignore-file code-duplication
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const signatureScript = readFileSync(join(__dirname, "motion-signature.browser.js"), "utf-8");
const script = readFileSync(join(__dirname, "motion-sample.browser.js"), "utf-8");

interface Geo {
  rect?: { left: number; top: number; width: number; height: number };
  opacity?: string;
  display?: string;
  visibility?: string;
  /** `::after` computed `content`; re-read on every call when a getter. */
  afterContent?: string;
}

interface SampleResult {
  data: Record<
    string,
    { rect: { left: number; right: number }; opacity: number; visible: boolean } | null
  >;
  liveness: Record<string, string>;
}

function installGeometry(byId: Record<string, Geo>): void {
  vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudoElement) => {
    const geo = byId[(element as Element).id] ?? {};
    if (pseudoElement) {
      return {
        content: pseudoElement === "::after" ? (geo.afterContent ?? "none") : "none",
      } as unknown as CSSStyleDeclaration;
    }
    return {
      display: geo.display ?? "block",
      visibility: geo.visibility ?? "visible",
      opacity: geo.opacity ?? "1",
    } as unknown as CSSStyleDeclaration;
  });

  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const geo = byId[this.id]?.rect ?? { left: 0, top: 0, width: 0, height: 0 };
    return {
      left: geo.left,
      top: geo.top,
      right: geo.left + geo.width,
      bottom: geo.top + geo.height,
      width: geo.width,
      height: geo.height,
    } as DOMRect;
  });
}

function installScript(): void {
  // The sampler reads the shared motion classifier at install time.
  // eslint-disable-next-line no-new-func
  new Function(signatureScript)();
  // eslint-disable-next-line no-new-func
  new Function(script)();
}

function sample(options: { selectors?: string[]; livenessScopes?: string[] }): SampleResult {
  const fn = (window as unknown as { __hyperframesMotionSample: (o: unknown) => SampleResult })
    .__hyperframesMotionSample;
  return fn(options);
}

describe("motion-sample.browser", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    delete (window as unknown as { __hyperframesMotionSample?: unknown }).__hyperframesMotionSample;
    Reflect.deleteProperty(window, "__hyperframesMotionSignature");
    Reflect.deleteProperty(window, "__hyperframesLayoutGeometry");
  });

  it("installs without the shared motion classifier and names it on the first call", () => {
    // Installing must not throw: addScriptTag resolves on load regardless, so
    // the driver only ever sees the error from its evaluate call.
    // eslint-disable-next-line no-new-func
    expect(() => new Function(script)()).not.toThrow();
    expect(() => sample({ livenessScopes: ["*"] })).toThrow(/motion-signature\.browser\.js/);
  });

  it("samples a present, visible selector and returns null for an absent one", () => {
    document.body.innerHTML = `
      <div data-composition-id="main"><div id="headline">Hi</div></div>
    `;
    installGeometry({
      headline: { rect: { left: 100, top: 50, width: 300, height: 80 }, opacity: "1" },
    });
    installScript();

    const result = sample({ selectors: ["#headline", "#missing"] });
    expect(result.data["#headline"]).toMatchObject({ visible: true, opacity: 1 });
    expect(result.data["#headline"]?.rect).toMatchObject({ left: 100, right: 400 });
    expect(result.data["#missing"]).toBeNull();
  });

  it("reports an explicitly asserted data-layout-ignore element as visible", () => {
    document.body.innerHTML = `
      <div data-composition-id="main"><div id="glow" data-layout-ignore>x</div></div>
    `;
    installGeometry({ glow: { rect: { left: 100, top: 50, width: 300, height: 80 } } });
    installScript();

    // The layout-audit opt-out excludes the layer from liveness, not from an
    // assertion that names it.
    expect(sample({ selectors: ["#glow"] }).data["#glow"]?.visible).toBe(true);
  });

  it("reflects inherited ancestor opacity", () => {
    document.body.innerHTML = `
      <div data-composition-id="main"><div id="wrap"><div id="headline">Hi</div></div></div>
    `;
    installGeometry({
      wrap: { rect: { left: 0, top: 0, width: 400, height: 200 }, opacity: "0.5" },
      headline: { rect: { left: 100, top: 50, width: 300, height: 80 }, opacity: "0.6" },
    });
    installScript();

    const result = sample({ selectors: ["#headline"] });
    expect(result.data["#headline"]?.opacity).toBeCloseTo(0.3, 5);
  });

  it("produces a different liveness signature when an element moves and an identical one when static", () => {
    document.body.innerHTML = `<div data-composition-id="main"><div id="box">x</div></div>`;

    installGeometry({ box: { rect: { left: 100, top: 100, width: 50, height: 50 } } });
    installScript();
    const before = sample({ livenessScopes: ["*"] }).liveness["*"];
    vi.restoreAllMocks();

    installGeometry({ box: { rect: { left: 100, top: 100, width: 50, height: 50 } } });
    installScript();
    const stillStatic = sample({ livenessScopes: ["*"] }).liveness["*"];
    vi.restoreAllMocks();

    installGeometry({ box: { rect: { left: 300, top: 100, width: 50, height: 50 } } });
    installScript();
    const moved = sample({ livenessScopes: ["*"] }).liveness["*"];

    expect(stillStatic).toBe(before);
    expect(moved).not.toBe(before);
  });

  // Liveness and the frozen-sweep guard share one classifier: a fixed-width
  // attr()-backed countdown that the sweep guard accepts as motion must not be
  // reported frozen by keepsMoving.
  it("changes the liveness signature when attr-backed generated content changes, in step with the sweep fingerprint", () => {
    document.body.innerHTML = `
      <div data-composition-id="main"><span id="countdown" data-txt="10"></span></div>
    `;
    installGeometry({
      countdown: {
        rect: { left: 280, top: 140, width: 80, height: 48 },
        get afterContent() {
          return JSON.stringify(document.getElementById("countdown")!.getAttribute("data-txt"));
        },
      },
    });
    installScript();
    const sweep = (window as unknown as { __hyperframesLayoutGeometry: () => string })
      .__hyperframesLayoutGeometry;

    const livenessBefore = sample({ livenessScopes: ["*"] }).liveness["*"];
    const sweepBefore = sweep();
    document.getElementById("countdown")!.setAttribute("data-txt", "09");

    expect(sample({ livenessScopes: ["*"] }).liveness["*"]).not.toBe(livenessBefore);
    expect(sweep()).not.toBe(sweepBefore);
  });

  it("signs a leaf withinSelector scope by the scope element itself", () => {
    document.body.innerHTML = `
      <div data-composition-id="main"><div id="logo">x</div></div>
    `;
    installGeometry({ logo: { rect: { left: 10, top: 10, width: 50, height: 50 } } });
    installScript();

    // The scope root is part of its own signature; a leaf scope is never "missing".
    expect((sample({ livenessScopes: ["#logo"] }).liveness["#logo"] ?? "").length).toBeGreaterThan(
      0,
    );
  });

  it("scopes liveness to a withinSelector and returns empty for a missing scope", () => {
    document.body.innerHTML = `
      <div data-composition-id="main"><div id="scene"><div id="box">x</div></div></div>
    `;
    installGeometry({
      scene: { rect: { left: 0, top: 0, width: 500, height: 500 } },
      box: { rect: { left: 10, top: 10, width: 50, height: 50 } },
    });
    installScript();

    const result = sample({ livenessScopes: ["#scene", "#nope"] });
    expect((result.liveness["#scene"] ?? "").length).toBeGreaterThan(0);
    expect(result.liveness["#nope"]).toBe("");
  });
});
