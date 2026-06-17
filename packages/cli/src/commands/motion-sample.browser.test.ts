// @vitest-environment happy-dom
// fallow-ignore-file code-duplication
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const script = readFileSync(join(__dirname, "motion-sample.browser.js"), "utf-8");

interface Geo {
  rect?: { left: number; top: number; width: number; height: number };
  opacity?: string;
  display?: string;
  visibility?: string;
}

interface SampleResult {
  data: Record<
    string,
    { rect: { left: number; right: number }; opacity: number; visible: boolean } | null
  >;
  liveness: Record<string, string>;
}

function installGeometry(byId: Record<string, Geo>): void {
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
    const geo = byId[(element as Element).id] ?? {};
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
