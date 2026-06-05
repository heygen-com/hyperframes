import { describe, it, expect } from "vitest";
import {
  parseGsapScript,
  serializeGsapAnimations,
  updateAnimationInScript,
  addAnimationToScript,
  removeAnimationFromScript,
} from "./gsapParser.js";
import type { ParsedGsap } from "./gsapParser.js";

// ── Helpers ────────────────────────────────────────────────────────────────

/** Assert a parse completed without crashing and returned the safe-default shape. */
function expectSafeDefault(result: ParsedGsap) {
  expect(result).toBeDefined();
  expect(Array.isArray(result.animations)).toBe(true);
  expect(typeof result.timelineVar).toBe("string");
}

/** Parse, serialize, re-parse, and assert structural equality of the animation IR. */
function assertRoundTrip(script: string) {
  const parsed1 = parseGsapScript(script);
  expect(parsed1.animations.length).toBeGreaterThan(0);

  const serialized = serializeGsapAnimations(parsed1.animations, parsed1.timelineVar, {
    preamble: parsed1.preamble,
    postamble: parsed1.postamble,
  });
  const parsed2 = parseGsapScript(serialized);

  expect(parsed2.animations.length).toBe(parsed1.animations.length);
  for (let i = 0; i < parsed1.animations.length; i++) {
    const a = parsed1.animations[i];
    const b = parsed2.animations[i];
    expect(b.targetSelector).toBe(a.targetSelector);
    expect(b.method).toBe(a.method);
    expect(b.position).toEqual(a.position);
    expect(b.duration).toEqual(a.duration);
    expect(b.ease).toEqual(a.ease);
    // Properties: numeric values must match; __raw values may re-serialize differently
    for (const [key, val] of Object.entries(a.properties)) {
      if (typeof val === "number") {
        expect(b.properties[key]).toBe(val);
      } else if (typeof val === "string" && val.startsWith("__raw:")) {
        // Raw values survive in some form — just confirm the key exists
        expect(b.properties).toHaveProperty(key);
      }
    }
    // Extras survive
    if (a.extras) {
      expect(b.extras).toBeDefined();
      for (const key of Object.keys(a.extras)) {
        expect(b.extras).toHaveProperty(key);
      }
    }
  }
}

// ── 1. Malformed Scripts ───────────────────────────────────────────────────

describe("1. Malformed scripts", () => {
  const cases = [
    {
      name: "unclosed brace",
      script: "const tl = gsap.timeline({ paused: true }); tl.to('#a', { x: 1",
    },
    {
      name: "unclosed parenthesis",
      script: "const tl = gsap.timeline({ paused: true }); tl.to('#a', { x: 1 }, 0",
    },
    { name: "random garbage", script: "@@@ not javascript at all ~~~" },
    { name: "partial assignment", script: "const tl =" },
    {
      name: "missing semicolons everywhere",
      script:
        "const tl = gsap.timeline({ paused: true })\ntl.to('#a', { x: 1 }, 0)\ntl.to('#b', { y: 2 }, 1)",
    },
    {
      name: "double commas",
      script: 'const tl = gsap.timeline({ paused: true }); tl.to("#a",, { x: 1 }, 0);',
    },
    { name: "HTML mixed in", script: "<div>hello</div>\nconst tl = gsap.timeline();" },
    { name: "only opening brace", script: "{" },
    { name: "only closing brace", script: "}" },
    { name: "null byte", script: "const tl = gsap.timeline();\x00 tl.to('#a', { x: 1 }, 0);" },
  ];

  for (const { name, script } of cases) {
    it(`does not crash on: ${name}`, () => {
      const result = parseGsapScript(script);
      expectSafeDefault(result);
    });

    it(`mutation functions are safe on: ${name}`, () => {
      // Some malformed scripts might parse as valid but empty — mutation safety
      // still applies (either noop or a valid transform)
      expect(() => updateAnimationInScript(script, "id", { duration: 1 })).not.toThrow();
      expect(() =>
        addAnimationToScript(script, {
          targetSelector: "#el",
          method: "to",
          position: 0,
          properties: { opacity: 1 },
          duration: 1,
        }),
      ).not.toThrow();
      expect(() => removeAnimationFromScript(script, "id")).not.toThrow();
    });
  }

  it("missing semicolons still parse tweens (ASI)", () => {
    const script = `
      const tl = gsap.timeline({ paused: true })
      tl.to("#a", { x: 100, duration: 0.5 }, 0)
      tl.to("#b", { y: 200, duration: 1 }, 1)
    `;
    const result = parseGsapScript(script);
    // Babel handles ASI — these should parse fine
    expect(result.animations.length).toBe(2);
  });
});

// ── 2. Empty / Minimal Scripts ─────────────────────────────────────────────

describe("2. Empty / minimal scripts", () => {
  it("empty string", () => {
    const result = parseGsapScript("");
    expectSafeDefault(result);
    expect(result.animations).toHaveLength(0);
  });

  it("whitespace only", () => {
    const result = parseGsapScript("   \n\t\n   ");
    expectSafeDefault(result);
    expect(result.animations).toHaveLength(0);
  });

  it("window.__timelines = {} with no tweens", () => {
    const script = "window.__timelines = {};";
    const result = parseGsapScript(script);
    expectSafeDefault(result);
    expect(result.animations).toHaveLength(0);
  });

  it("timeline declaration with no tween calls", () => {
    const script = "const tl = gsap.timeline({ paused: true });";
    const result = parseGsapScript(script);
    expect(result.timelineVar).toBe("tl");
    expect(result.animations).toHaveLength(0);
  });

  it("only comments", () => {
    const script = "// this is a comment\n/* block comment */";
    const result = parseGsapScript(script);
    expectSafeDefault(result);
    expect(result.animations).toHaveLength(0);
  });

  it("tween with only selector and empty vars object", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el", {}, 0);
    `;
    const result = parseGsapScript(script);
    expect(result.animations).toHaveLength(1);
    expect(Object.keys(result.animations[0].properties)).toHaveLength(0);
    expect(result.animations[0].duration).toBeUndefined();
  });
});

// ── 3. Extreme Values ──────────────────────────────────────────────────────

describe("3. Extreme values", () => {
  it("very large numbers", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el", { x: 1e10, y: 99999999, duration: 1000000 }, 0);
    `;
    const result = parseGsapScript(script);
    expect(result.animations).toHaveLength(1);
    expect(result.animations[0].properties.x).toBe(1e10);
    expect(result.animations[0].properties.y).toBe(99999999);
    expect(result.animations[0].duration).toBe(1000000);
  });

  it("very small numbers", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el", { opacity: 0.001, duration: 0.0001 }, 0.00001);
    `;
    const result = parseGsapScript(script);
    expect(result.animations).toHaveLength(1);
    expect(result.animations[0].properties.opacity).toBe(0.001);
    expect(result.animations[0].duration).toBe(0.0001);
    expect(result.animations[0].position).toBeCloseTo(0.00001);
  });

  it("negative position", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el", { x: 100, duration: 1 }, -5);
    `;
    const result = parseGsapScript(script);
    expect(result.animations).toHaveLength(1);
    expect(result.animations[0].position).toBe(-5);
  });

  it("zero duration", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el", { x: 100, duration: 0 }, 0);
    `;
    const result = parseGsapScript(script);
    expect(result.animations[0].duration).toBe(0);
  });

  it("NaN-producing division by zero is handled", () => {
    const script = `
      const ZERO = 0;
      const BAD = 100 / ZERO;
      const tl = gsap.timeline({ paused: true });
      tl.to("#el", { x: BAD, y: 50, duration: 1 }, 0);
    `;
    const result = parseGsapScript(script);
    expect(result.animations).toHaveLength(1);
    // Division by zero returns undefined from resolveNode, so BAD is unresolvable
    // x should be __raw: or undefined, y should be 50
    expect(result.animations[0].properties.y).toBe(50);
    // BAD was never bound (division by zero returns undefined), so the reference is raw
    const xVal = result.animations[0].properties.x;
    expect(typeof xVal === "string" && xVal.startsWith("__raw:")).toBe(true);
  });

  it("Infinity literal", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el", { x: Infinity, y: 50, duration: 1 }, 0);
    `;
    const result = parseGsapScript(script);
    expect(result.animations).toHaveLength(1);
    // Infinity is an Identifier, not a NumericLiteral — should be __raw
    const xVal = result.animations[0].properties.x;
    expect(typeof xVal === "string" && xVal.startsWith("__raw:")).toBe(true);
    expect(result.animations[0].properties.y).toBe(50);
  });
});

// ── 4. Unicode in Selectors ────────────────────────────────────────────────

describe("4. Unicode in selectors", () => {
  it("Japanese characters in selector", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#日本語", { x: 100, duration: 1 }, 0);
    `;
    const result = parseGsapScript(script);
    expect(result.animations).toHaveLength(1);
    expect(result.animations[0].targetSelector).toBe("#日本語");
  });

  it("emoji in selector", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#rocket-🚀", { opacity: 1, duration: 0.5 }, 0);
    `;
    const result = parseGsapScript(script);
    expect(result.animations).toHaveLength(1);
    expect(result.animations[0].targetSelector).toBe("#rocket-🚀");
  });

  it("Arabic and Cyrillic selectors", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#عربي", { x: 50, duration: 1 }, 0);
      tl.to("#кириллица", { y: 100, duration: 1 }, 1);
    `;
    const result = parseGsapScript(script);
    expect(result.animations).toHaveLength(2);
    expect(result.animations[0].targetSelector).toBe("#عربي");
    expect(result.animations[1].targetSelector).toBe("#кириллица");
  });

  it("class selector with unicode", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to(".コンポーネント", { scale: 2, duration: 0.5 }, 0);
    `;
    const result = parseGsapScript(script);
    expect(result.animations[0].targetSelector).toBe(".コンポーネント");
  });
});

// ── 5. Deeply Nested Objects ───────────────────────────────────────────────

describe("5. Deeply nested objects", () => {
  it("complex stagger object preserved in extras", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to(".items", { opacity: 1, duration: 0.5, stagger: { amount: 1, grid: [3, 3], from: "center", axis: "x" } }, 0);
    `;
    const result = parseGsapScript(script);
    expect(result.animations).toHaveLength(1);
    expect(result.animations[0].extras).toBeDefined();
    expect(result.animations[0].extras!.stagger).toBeDefined();
    // stagger should be __raw: containing the nested object source
    const stagger = String(result.animations[0].extras!.stagger);
    expect(stagger.startsWith("__raw:")).toBe(true);
    expect(stagger).toContain("amount");
    expect(stagger).toContain("grid");
    expect(stagger).toContain("center");
  });

  it("complex stagger survives round-trip serialization", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to(".items", { opacity: 1, duration: 0.5, stagger: { amount: 1, grid: [3, 3], from: "center", axis: "x" } }, 0);
    `;
    const parsed = parseGsapScript(script);
    const serialized = serializeGsapAnimations(parsed.animations, parsed.timelineVar, {
      preamble: parsed.preamble,
      postamble: parsed.postamble,
    });
    expect(serialized).toContain("stagger:");
    expect(serialized).toContain("amount");
    expect(serialized).toContain("grid");
  });

  it("nested ease config object (non-string ease)", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el", { x: 100, duration: 1, ease: "back.out(1.7)" }, 0);
    `;
    const result = parseGsapScript(script);
    expect(result.animations[0].ease).toBe("back.out(1.7)");
  });
});

// ── 6. Chained Method Calls ────────────────────────────────────────────────

describe("6. Chained method calls", () => {
  it("chained tl.to().to().from() — every link is detected", () => {
    // Each link of a chain is called on the return value of the previous one
    // (ultimately the timeline). The parser walks the member chain to its root,
    // so every link is captured, not just the first.
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#a", { x: 100, duration: 0.5 }, 0).to("#b", { y: 200, duration: 0.5 }, 1).from("#c", { scale: 0, duration: 1 }, 2);
    `;
    const result = parseGsapScript(script);
    expect(result.animations).toHaveLength(3);
    const bySelector = Object.fromEntries(result.animations.map((a) => [a.targetSelector, a]));
    expect(bySelector["#a"]?.properties.x).toBe(100);
    expect(bySelector["#b"]?.properties.y).toBe(200);
    expect(bySelector["#c"]?.method).toBe("from");
  });

  it("separate statements all parse", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#a", { x: 100, duration: 0.5 }, 0);
      tl.to("#b", { y: 200, duration: 0.5 }, 1);
      tl.from("#c", { scale: 0, duration: 1 }, 2);
    `;
    const result = parseGsapScript(script);
    expect(result.animations).toHaveLength(3);
  });
});

// ── 7. Template Literals in Values ─────────────────────────────────────────

describe("7. Template literals in values", () => {
  it("template literal with no expressions resolves to string", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el", { x: 50, duration: 1, ease: \`power2.out\` }, 0);
    `;
    const result = parseGsapScript(script);
    expect(result.animations).toHaveLength(1);
    expect(result.animations[0].ease).toBe("power2.out");
  });

  it("template literal with expression becomes __raw", () => {
    const script = `
      const val = 100;
      const tl = gsap.timeline({ paused: true });
      tl.to("#el", { x: \`\${val}px\`, y: 50, duration: 1 }, 0);
    `;
    const result = parseGsapScript(script);
    expect(result.animations).toHaveLength(1);
    // Template literal with expressions is not resolvable
    const xVal = result.animations[0].properties.x;
    expect(typeof xVal === "string" && xVal.startsWith("__raw:")).toBe(true);
    expect(result.animations[0].properties.y).toBe(50);
  });
});

// ── 8. Multiple Scripts in One HTML ────────────────────────────────────────

describe("8. Multiple timelines", () => {
  it("two gsap.timeline() calls sets multipleTimelines flag", () => {
    const script = `
      const tl1 = gsap.timeline({ paused: true });
      tl1.to("#a", { x: 100, duration: 1 }, 0);
      const tl2 = gsap.timeline({ paused: true });
      tl2.to("#b", { y: 200, duration: 1 }, 0);
    `;
    const result = parseGsapScript(script);
    expect(result.multipleTimelines).toBe(true);
    // Parser only tracks the first timeline variable
    expect(result.timelineVar).toBe("tl1");
    // Only tl1 tweens are captured
    expect(result.animations.every((a) => a.targetSelector === "#a")).toBe(true);
  });

  it("two scripts concatenated with same variable name", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#first", { opacity: 1, duration: 0.5 }, 0);
      // Second block re-uses tl but creates a new timeline
      const tl2 = gsap.timeline({ paused: true });
      tl.to("#second", { opacity: 0.5, duration: 1 }, 1);
    `;
    const result = parseGsapScript(script);
    // Both .to() calls use "tl" as the callee object, so both are captured
    expect(result.multipleTimelines).toBe(true);
    const selectors = result.animations.map((a) => a.targetSelector);
    expect(selectors).toContain("#first");
    expect(selectors).toContain("#second");
  });
});

// ── 9. Comments Everywhere ─────────────────────────────────────────────────

describe("9. Comments everywhere", () => {
  it("inline comments inside tween args", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el", { /* fade in */ opacity: 1 /*, y: 200*/, duration: 0.5 }, 0);
    `;
    const result = parseGsapScript(script);
    expect(result.animations).toHaveLength(1);
    expect(result.animations[0].properties.opacity).toBe(1);
    // y: 200 is commented out, should not appear
    expect(result.animations[0].properties).not.toHaveProperty("y");
  });

  it("line comments between tween calls", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      // First animation
      tl.set("#el", { opacity: 0 }, 0);
      // Second animation
      tl.to("#el", { opacity: 1, duration: 1 }, 0.5);
      // Done
    `;
    const result = parseGsapScript(script);
    expect(result.animations).toHaveLength(2);
  });

  it("comment inside selector string (not really a comment)", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el /* not a comment */", { x: 100, duration: 1 }, 0);
    `;
    const result = parseGsapScript(script);
    expect(result.animations).toHaveLength(1);
    expect(result.animations[0].targetSelector).toBe("#el /* not a comment */");
  });
});

// ── 10. Arrow Functions as Values ──────────────────────────────────────────

describe("10. Arrow functions as values", () => {
  it("arrow function property becomes __raw", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el", { x: (i) => i * 50, opacity: 1, duration: 1 }, 0);
    `;
    const result = parseGsapScript(script);
    expect(result.animations).toHaveLength(1);
    // Arrow function is not resolvable
    const xVal = result.animations[0].properties.x;
    expect(typeof xVal === "string" && xVal.startsWith("__raw:")).toBe(true);
    // Resolvable values still work
    expect(result.animations[0].properties.opacity).toBe(1);
  });

  it("arrow function in stagger becomes __raw extra", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to(".items", { opacity: 1, duration: 0.5, stagger: (i) => i * 0.1 }, 0);
    `;
    const result = parseGsapScript(script);
    expect(result.animations[0].extras).toBeDefined();
    const stagger = String(result.animations[0].extras!.stagger);
    expect(stagger.startsWith("__raw:")).toBe(true);
  });

  it("arrow function round-trips via serialization", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el", { x: (i) => i * 50, opacity: 1, duration: 1 }, 0);
    `;
    const parsed = parseGsapScript(script);
    const serialized = serializeGsapAnimations(parsed.animations, parsed.timelineVar, {
      preamble: parsed.preamble,
      postamble: parsed.postamble,
    });
    // The raw arrow function should be emitted without quotes
    expect(serialized).toContain("(i) => i * 50");
    expect(serialized).not.toContain('"(i) => i * 50"');
  });
});

// ── 11. Spread Operator ────────────────────────────────────────────────────

describe("11. Spread operator", () => {
  it("spread in vars object does not crash — spread properties are skipped", () => {
    const script = `
      const baseVars = { opacity: 0, x: -50 };
      const tl = gsap.timeline({ paused: true });
      tl.to("#el", { ...baseVars, y: 100, duration: 1 }, 0);
    `;
    const result = parseGsapScript(script);
    expect(result.animations).toHaveLength(1);
    // Spread properties are SpreadElement, not ObjectProperty — they're skipped
    // Only explicitly written properties are captured
    expect(result.animations[0].properties.y).toBe(100);
    expect(result.animations[0].duration).toBe(1);
  });
});

// ── 12. Conditional Expressions ────────────────────────────────────────────

describe("12. Conditional expressions", () => {
  it("ternary expression becomes __raw", () => {
    const script = `
      const condition = true;
      const tl = gsap.timeline({ paused: true });
      tl.to("#el", { x: condition ? 100 : 200, y: 50, duration: 1 }, 0);
    `;
    const result = parseGsapScript(script);
    expect(result.animations).toHaveLength(1);
    // ConditionalExpression is not handled by resolveNode
    const xVal = result.animations[0].properties.x;
    expect(typeof xVal === "string" && xVal.startsWith("__raw:")).toBe(true);
    expect(result.animations[0].properties.y).toBe(50);
  });

  it("conditional in position argument defaults to 0", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el", { x: 100, duration: 1 }, someCondition ? 0 : 2);
    `;
    const result = parseGsapScript(script);
    expect(result.animations).toHaveLength(1);
    // Position can't be resolved — falls back to 0
    expect(result.animations[0].position).toBe(0);
  });
});

// ── 13. Round-Trip Stability ───────────────────────────────────────────────

describe("13. Round-trip stability", () => {
  it("basic .to() round-trips", () => {
    assertRoundTrip(`
      const tl = gsap.timeline({ paused: true });
      tl.to("#el", { opacity: 1, x: 50, duration: 0.5, ease: "power2.out" }, 0);
    `);
  });

  it("basic .from() round-trips", () => {
    assertRoundTrip(`
      const tl = gsap.timeline({ paused: true });
      tl.from("#el", { opacity: 0, y: -100, duration: 1, ease: "back.out" }, 0.5);
    `);
  });

  it("basic .set() round-trips", () => {
    assertRoundTrip(`
      const tl = gsap.timeline({ paused: true });
      tl.set("#el", { opacity: 0, scale: 0.5 }, 0);
    `);
  });

  it("basic .fromTo() round-trips", () => {
    assertRoundTrip(`
      const tl = gsap.timeline({ paused: true });
      tl.fromTo("#el", { opacity: 0 }, { opacity: 1, duration: 1, ease: "power1.inOut" }, 2);
    `);
  });

  it("stagger extra round-trips", () => {
    assertRoundTrip(`
      const tl = gsap.timeline({ paused: true });
      tl.to(".items", { opacity: 1, duration: 0.5, stagger: 0.1 }, 0);
    `);
  });

  it("yoyo + repeat extras round-trip", () => {
    assertRoundTrip(`
      const tl = gsap.timeline({ paused: true });
      tl.to("#el", { x: 100, duration: 1, yoyo: true, repeat: 3, repeatDelay: 0.2 }, 0);
    `);
  });

  it("multiple tweens round-trip with ordering preserved", () => {
    assertRoundTrip(`
      const tl = gsap.timeline({ paused: true });
      tl.set("#el1", { opacity: 0 }, 0);
      tl.to("#el1", { opacity: 1, duration: 0.5 }, 0);
      tl.to("#el2", { x: 100, duration: 1 }, 1);
      tl.from("#el3", { y: -50, duration: 0.3 }, 2);
    `);
  });

  it("string position round-trips", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el1", { opacity: 1, duration: 0.5 }, "+=1");
      tl.to("#el2", { x: 100, duration: 1 }, "<");
    `;
    const parsed1 = parseGsapScript(script);
    const serialized = serializeGsapAnimations(parsed1.animations, parsed1.timelineVar, {
      preamble: parsed1.preamble,
      postamble: parsed1.postamble,
    });
    const parsed2 = parseGsapScript(serialized);
    expect(parsed2.animations[0].position).toBe("+=1");
    expect(parsed2.animations[1].position).toBe("<");
  });

  it("double round-trip: parse -> serialize -> parse -> serialize -> parse gives stable IR", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.set("#a", { opacity: 0 }, 0);
      tl.to("#a", { opacity: 1, x: 100, duration: 0.5, ease: "power2.out" }, 0.5);
      tl.to("#b", { y: -50, scale: 1.5, duration: 1, stagger: 0.1 }, 1);
    `;
    const parsed1 = parseGsapScript(script);
    const ser1 = serializeGsapAnimations(parsed1.animations, parsed1.timelineVar, {
      preamble: parsed1.preamble,
      postamble: parsed1.postamble,
    });
    const parsed2 = parseGsapScript(ser1);
    const ser2 = serializeGsapAnimations(parsed2.animations, parsed2.timelineVar, {
      preamble: parsed2.preamble,
      postamble: parsed2.postamble,
    });
    const parsed3 = parseGsapScript(ser2);

    // Third parse should match second parse exactly
    expect(parsed3.animations.length).toBe(parsed2.animations.length);
    for (let i = 0; i < parsed2.animations.length; i++) {
      expect(parsed3.animations[i].targetSelector).toBe(parsed2.animations[i].targetSelector);
      expect(parsed3.animations[i].method).toBe(parsed2.animations[i].method);
      expect(parsed3.animations[i].position).toEqual(parsed2.animations[i].position);
      expect(parsed3.animations[i].properties).toEqual(parsed2.animations[i].properties);
    }
  });
});

// ── 14. ID Collision ───────────────────────────────────────────────────────

describe("14. ID collision", () => {
  it("three tweens with same selector, method, position get disambiguated", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el", { opacity: 0, duration: 0.3 }, 0);
      tl.to("#el", { x: 100, duration: 0.5 }, 0);
      tl.to("#el", { y: 50, duration: 0.7 }, 0);
    `;
    const result = parseGsapScript(script);
    expect(result.animations).toHaveLength(3);
    const ids = result.animations.map((a) => a.id);
    // All IDs must be unique
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe("#el-to-0");
    expect(ids[1]).toBe("#el-to-0-2");
    expect(ids[2]).toBe("#el-to-0-3");
  });

  it("disambiguated IDs are stable across parses", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el", { opacity: 0 }, 0);
      tl.to("#el", { x: 100 }, 0);
    `;
    const r1 = parseGsapScript(script);
    const r2 = parseGsapScript(script);
    expect(r1.animations[0].id).toBe(r2.animations[0].id);
    expect(r1.animations[1].id).toBe(r2.animations[1].id);
  });

  it("mutation by ID targets the correct animation among collisions", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el", { opacity: 0, duration: 0.3 }, 0);
      tl.to("#el", { opacity: 1, duration: 0.5 }, 0);
    `;
    const parsed = parseGsapScript(script);
    const secondId = parsed.animations[1].id; // "#el-to-0-2"
    const updated = updateAnimationInScript(script, secondId, { duration: 2 });
    const reparsed = parseGsapScript(updated);
    // The second animation should have updated duration
    expect(reparsed.animations[1].duration).toBe(2);
    // The first should be untouched
    expect(reparsed.animations[0].duration).toBe(0.3);
  });
});

// ── 15. Very Long Scripts ──────────────────────────────────────────────────

describe("15. Very long scripts (50+ tweens)", () => {
  it("parses 50 sequential tweens", () => {
    const tweens = Array.from(
      { length: 50 },
      (_, i) =>
        `tl.to("#el${i}", { x: ${i * 10}, opacity: ${(i % 10) / 10}, duration: 0.5 }, ${i * 0.5});`,
    ).join("\n      ");
    const script = `
      const tl = gsap.timeline({ paused: true });
      ${tweens}
    `;
    const result = parseGsapScript(script);
    expect(result.animations).toHaveLength(50);
    // Spot check first and last
    expect(result.animations[0].targetSelector).toBe("#el0");
    expect(result.animations[0].properties.x).toBe(0);
    expect(result.animations[49].targetSelector).toBe("#el49");
    expect(result.animations[49].properties.x).toBe(490);
  });

  it("parses 100 tweens targeting the same element", () => {
    const tweens = Array.from(
      { length: 100 },
      (_, i) => `tl.to("#el", { x: ${i}, duration: 0.1 }, ${i * 0.1});`,
    ).join("\n      ");
    const script = `
      const tl = gsap.timeline({ paused: true });
      ${tweens}
    `;
    const result = parseGsapScript(script);
    expect(result.animations).toHaveLength(100);
    // All IDs must be unique despite same selector
    const ids = result.animations.map((a) => a.id);
    expect(new Set(ids).size).toBe(100);
  });

  it("round-trips 50 tweens", () => {
    const tweens = Array.from(
      { length: 50 },
      (_, i) => `tl.to("#el${i}", { x: ${i * 10}, duration: 0.5 }, ${i * 0.5});`,
    ).join("\n      ");
    const script = `
      const tl = gsap.timeline({ paused: true });
      ${tweens}
    `;
    const parsed = parseGsapScript(script);
    const serialized = serializeGsapAnimations(parsed.animations, parsed.timelineVar, {
      preamble: parsed.preamble,
      postamble: parsed.postamble,
    });
    const reparsed = parseGsapScript(serialized);
    expect(reparsed.animations.length).toBe(50);
    for (let i = 0; i < 50; i++) {
      expect(reparsed.animations[i].targetSelector).toBe(parsed.animations[i].targetSelector);
      expect(reparsed.animations[i].properties.x).toBe(parsed.animations[i].properties.x);
    }
  });
});

// ── Additional Edge Cases ──────────────────────────────────────────────────

describe("Additional edge cases", () => {
  it("selector with special CSS characters", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#my-element_v2.class", { x: 100, duration: 1 }, 0);
      tl.to(".parent > .child", { y: 50, duration: 0.5 }, 0);
      tl.to("[data-anim='fade']", { opacity: 1, duration: 1 }, 0);
    `;
    const result = parseGsapScript(script);
    expect(result.animations).toHaveLength(3);
    expect(result.animations[0].targetSelector).toBe("#my-element_v2.class");
    expect(result.animations[1].targetSelector).toBe(".parent > .child");
    expect(result.animations[2].targetSelector).toBe("[data-anim='fade']");
  });

  it("string concatenation in property value", () => {
    const script = `
      const prefix = "100";
      const tl = gsap.timeline({ paused: true });
      tl.to("#el", { x: prefix + "px", y: 50, duration: 1 }, 0);
    `;
    const result = parseGsapScript(script);
    expect(result.animations[0].properties.x).toBe("100px");
    expect(result.animations[0].properties.y).toBe(50);
  });

  it("arithmetic in position argument", () => {
    const script = `
      const START = 2;
      const tl = gsap.timeline({ paused: true });
      tl.to("#el", { x: 100, duration: 1 }, START + 0.5);
    `;
    const result = parseGsapScript(script);
    expect(result.animations[0].position).toBe(2.5);
  });

  it("var declaration for timeline", () => {
    const script = `
      var tl = gsap.timeline({ paused: true });
      tl.to("#el", { opacity: 1, duration: 1 }, 0);
    `;
    const result = parseGsapScript(script);
    expect(result.timelineVar).toBe("tl");
    expect(result.animations).toHaveLength(1);
  });

  it("assignment expression for timeline (no declaration keyword)", () => {
    const script = `
      window.tl = gsap.timeline({ paused: true });
    `;
    const result = parseGsapScript(script);
    // Window member expression is not a bare Identifier, so timelineVar may not be found
    // The parser checks for Identifier left in assignment expressions
    // window.tl is a MemberExpression, not Identifier — should not set timelineVar
    expectSafeDefault(result);
  });

  it("non-GSAP method calls on the timeline are ignored", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el", { opacity: 1, duration: 0.5 }, 0);
      tl.play();
      tl.pause();
      tl.reverse();
      tl.seek(2);
    `;
    const result = parseGsapScript(script);
    // Only .to() is a tween method — play/pause/reverse/seek are not in GSAP_METHODS
    expect(result.animations).toHaveLength(1);
  });

  it("tween with only one argument (selector only) is skipped", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el");
      tl.to("#el2", { opacity: 1, duration: 0.5 }, 0);
    `;
    const result = parseGsapScript(script);
    // First tween has < 2 args — should be skipped
    expect(result.animations).toHaveLength(1);
    expect(result.animations[0].targetSelector).toBe("#el2");
  });

  it("resolves a variable reference selector to its queried CSS selector", () => {
    const script = `
      const el = document.querySelector("#el");
      const tl = gsap.timeline({ paused: true });
      tl.to(el, { opacity: 1, duration: 0.5 }, 0);
      tl.to("#el2", { x: 100, duration: 0.5 }, 0);
    `;
    const result = parseGsapScript(script);
    // `el` is bound to `document.querySelector("#el")`, so it resolves to "#el".
    expect(result.animations).toHaveLength(2);
    expect(result.animations[0].targetSelector).toBe("#el");
    expect(result.animations[1].targetSelector).toBe("#el2");
  });

  it("marks a variable target that is not bound to a DOM lookup as __unresolved__", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to(mysteryTarget, { opacity: 1, duration: 0.5 }, 0);
      tl.to("#el2", { x: 100, duration: 0.5 }, 0);
    `;
    const result = parseGsapScript(script);
    // mysteryTarget has no resolvable selector binding — kept with __unresolved__ marker.
    expect(result.animations).toHaveLength(2);
    expect(result.animations[0].targetSelector).toBe("__unresolved__");
    expect(result.animations[0].hasUnresolvedSelector).toBe(true);
    expect(result.animations[1].targetSelector).toBe("#el2");
  });

  it("boolean values in vars are not included in properties", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el", { opacity: 1, immediateRender: false, duration: 0.5 }, 0);
    `;
    const result = parseGsapScript(script);
    expect(result.animations[0].properties.opacity).toBe(1);
    // immediateRender is in EXTRAS_KEYS, should be in extras
    expect(result.animations[0].extras).toBeDefined();
    expect(result.animations[0].extras!.immediateRender).toBeDefined();
    // Should not be in properties
    expect(result.animations[0].properties).not.toHaveProperty("immediateRender");
  });

  it("callbacks (onComplete etc.) are dropped", () => {
    // Note: validation would flag these, but the parser just drops them
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el", { opacity: 1, duration: 1, onComplete: function() { console.log("done"); } }, 0);
    `;
    const result = parseGsapScript(script);
    expect(result.animations).toHaveLength(1);
    expect(result.animations[0].properties).not.toHaveProperty("onComplete");
    expect(result.animations[0].extras).toBeUndefined();
  });

  it("delay is not included in properties (BUILTIN_VAR_KEYS)", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el", { opacity: 1, duration: 0.5, delay: 0.2 }, 0);
    `;
    const result = parseGsapScript(script);
    expect(result.animations[0].properties).not.toHaveProperty("delay");
    expect(result.animations[0].properties).not.toHaveProperty("duration");
  });

  it("percentage string values in properties survive", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el", { width: "50%", opacity: 1, duration: 1 }, 0);
    `;
    const result = parseGsapScript(script);
    expect(result.animations[0].properties.width).toBe("50%");
    expect(result.animations[0].properties.opacity).toBe(1);
  });

  it("scope resolution: binary expression with one unresolvable side", () => {
    const script = `
      const BASE = 100;
      const tl = gsap.timeline({ paused: true });
      tl.to("#el", { x: BASE + unknownVar, y: BASE * 2, duration: 1 }, 0);
    `;
    const result = parseGsapScript(script);
    // BASE + unknownVar: left is 100, right is undefined => result is undefined => __raw
    const xVal = result.animations[0].properties.x;
    expect(typeof xVal === "string" && xVal.startsWith("__raw:")).toBe(true);
    // BASE * 2: both resolved => 200
    expect(result.animations[0].properties.y).toBe(200);
  });

  it("negative position in ID generation", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.to("#el", { x: 100, duration: 1 }, -2.5);
    `;
    const result = parseGsapScript(script);
    // ID uses Math.round(position * 1000) for numeric positions
    expect(result.animations[0].id).toBe("#el-to--2500");
  });

  it("fromTo with no position arg defaults to 0", () => {
    const script = `
      const tl = gsap.timeline({ paused: true });
      tl.fromTo("#el", { opacity: 0 }, { opacity: 1, duration: 1 });
    `;
    const result = parseGsapScript(script);
    expect(result.animations).toHaveLength(1);
    // For fromTo, position is args[3] which is undefined => defaults to 0
    expect(result.animations[0].position).toBe(0);
  });
});
