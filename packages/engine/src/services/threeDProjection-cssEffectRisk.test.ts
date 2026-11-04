/**
 * Focused coverage for `detectCssEffectRisk`'s effect detection — specifically
 * that `filter: drop-shadow(...)` gates the fast path everywhere `blur(` does
 * (computed styles, stylesheet rules, GSAP tween vars). drop-shadow is a
 * documented ~29 dB damage case (drop-shadow-on-SVG especially); a gate that
 * detects blur but not drop-shadow silently ships that damage.
 *
 * The detector's page-side closure runs verbatim inside a mock `page.evaluate`
 * with a minimal DOM shim, so these tests pin the real scan logic, not a copy.
 */

import { afterEach, describe, expect, it } from "vitest";
import type { Page } from "puppeteer-core";
import { detectCssEffectRisk, scanCssEffects } from "./threeDProjection.js";

interface ShimEnv {
  /** Computed style returned for every element. */
  computed?: Partial<{
    filter: string;
    backdropFilter: string;
    mixBlendMode: string;
    animationName: string;
    animationDuration: string;
  }>;
  /** Raw cssText of stylesheet rules visible to the scan. */
  styleRules?: string[];
  /** Style rules with a selector, and the elements that selector matches under the root. */
  selectorRules?: Array<{ cssText: string; selectorText: string }>;
  matches?: Record<string, object[]>;
  /** GSAP-shaped timelines exposed as window.__timelines. */
  timelines?: Record<string, unknown>;
}

const SHIMMED_GLOBALS = ["document", "window", "getComputedStyle"] as const;
const saved = new Map<string, unknown>();

function installShim(env: ShimEnv): void {
  const el = {
    tagName: "DIV",
    querySelectorAll: (selector: string) => env.matches?.[selector] ?? [],
  };
  const doc = {
    querySelector: (sel: string) => (sel === "[data-composition-id]" ? el : null),
    querySelectorAll: () => [],
    styleSheets: [
      ...(env.styleRules ?? []).map((cssText) => ({ cssRules: [{ cssText }] })),
      ...(env.selectorRules ?? []).map((rule) => ({ cssRules: [rule] })),
    ],
  };
  const win = { __timelines: env.timelines ?? {} };
  const computed = {
    filter: "none",
    backdropFilter: "",
    webkitBackdropFilter: "",
    mixBlendMode: "normal",
    animationName: "none",
    animationDuration: "0s",
    ...env.computed,
  };
  const g = globalThis as Record<string, unknown>;
  for (const k of SHIMMED_GLOBALS) {
    if (!saved.has(k)) saved.set(k, g[k]);
  }
  g.document = doc;
  g.window = win;
  g.getComputedStyle = () => computed;
}

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  for (const [k, v] of saved) {
    if (v === undefined) delete g[k];
    else g[k] = v;
  }
  saved.clear();
});

function makeMockPage(env: ShimEnv): Page {
  return {
    evaluate: async (fn: () => unknown) => {
      installShim(env);
      return fn();
    },
  } as unknown as Page;
}

describe("detectCssEffectRisk drop-shadow gating", () => {
  it("detects drop-shadow in computed styles", async () => {
    const risk = await detectCssEffectRisk(
      makeMockPage({ computed: { filter: "drop-shadow(0 2px 4px black)" } }),
    );
    expect(risk).toBe("filter:drop-shadow");
  });

  it("detects drop-shadow declared in a stylesheet rule", async () => {
    const risk = await detectCssEffectRisk(
      makeMockPage({ styleRules: [".card { filter: drop-shadow(0 0 8px red); }"] }),
    );
    expect(risk).toBe("filter:drop-shadow");
  });

  it("detects drop-shadow animated via GSAP tween vars", async () => {
    const tween = { vars: { filter: "drop-shadow(0 4px 12px rgba(0,0,0,0.5))" } };
    const timeline = { getChildren: () => [tween] };
    const risk = await detectCssEffectRisk(makeMockPage({ timelines: { main: timeline } }));
    expect(risk).toBe("filter:drop-shadow");
  });

  it("still detects blur in all three paths", async () => {
    expect(await detectCssEffectRisk(makeMockPage({ computed: { filter: "blur(4px)" } }))).toBe(
      "filter:blur",
    );
    expect(
      await detectCssEffectRisk(makeMockPage({ styleRules: [".x { filter: blur(2px); }"] })),
    ).toBe("filter:blur");
    const tween = { vars: { filter: "blur(6px)" } };
    expect(
      await detectCssEffectRisk(
        makeMockPage({ timelines: { main: { getChildren: () => [tween] } } }),
      ),
    ).toBe("filter:blur");
  });

  it("returns null for an effect-free composition", async () => {
    expect(await detectCssEffectRisk(makeMockPage({}))).toBe(null);
  });
});

describe("scanCssEffects", () => {
  it("ties a computed effect to its element", async () => {
    const scan = await scanCssEffects(makeMockPage({ computed: { filter: "blur(4px)" } }), true);
    expect(scan).toEqual({ reason: "filter:blur", bounded: true, callbackFrom: null });
    expect(
      (globalThis as { window?: { __hfCssFxTargets?: unknown[] } }).window?.__hfCssFxTargets,
    ).toHaveLength(1);
  });

  it("ties a stylesheet rule to the elements its selector matches", async () => {
    const target = {};
    const scan = await scanCssEffects(
      makeMockPage({
        selectorRules: [
          { cssText: ".x { filter: drop-shadow(0 0 4px #000); }", selectorText: ".x" },
        ],
        matches: { ".x": [target] },
      }),
      true,
    );
    expect(scan).toEqual({ reason: "filter:drop-shadow", bounded: true, callbackFrom: null });
    expect(
      (globalThis as { window?: { __hfCssFxTargets?: unknown[] } }).window?.__hfCssFxTargets,
    ).toEqual([target]);
  });

  it("is unbounded when a rule matches nothing yet, since a class swap could apply it on any frame", async () => {
    const scan = await scanCssEffects(
      makeMockPage({
        selectorRules: [{ cssText: ".later { filter: blur(2px); }", selectorText: ".later" }],
      }),
      true,
    );
    expect(scan).toEqual({ reason: "filter:blur", bounded: false, callbackFrom: null });
  });

  it("is unbounded for a CSS animation", async () => {
    expect(
      (
        await scanCssEffects(
          makeMockPage({ computed: { animationName: "spin", animationDuration: "2s" } }),
          true,
        )
      ).bounded,
    ).toBe(false);
  });

  it("stops at the first match when not collecting", async () => {
    const scan = await scanCssEffects(
      makeMockPage({ computed: { filter: "blur(4px)", mixBlendMode: "multiply" } }),
      false,
    );
    expect(scan.reason).toBe("filter:blur");
  });

  it("reports when the first timeline callback can fire, after which the effect can reach any element", async () => {
    const timeline = {
      vars: {},
      startTime: () => 0,
      getChildren: () => [
        { vars: { onComplete: () => {} }, startTime: () => 12 },
        { vars: { onUpdate: () => {} }, startTime: () => 30 },
      ],
    };
    const scan = await scanCssEffects(
      makeMockPage({
        computed: { filter: "drop-shadow(0 0 4px #000)" },
        timelines: { main: timeline },
      }),
      true,
    );
    expect(scan).toEqual({ reason: "filter:drop-shadow", bounded: true, callbackFrom: 12 });
  });

  it("stays bounded for a timeline of plain tweens", async () => {
    const timeline = {
      vars: {},
      getChildren: () => [{ vars: { x: 10 }, getChildren: undefined }],
    };
    const scan = await scanCssEffects(
      makeMockPage({
        computed: { filter: "drop-shadow(0 0 4px #000)" },
        timelines: { main: timeline },
      }),
      true,
    );
    expect(scan).toMatchObject({ bounded: true, callbackFrom: null });
  });
});
