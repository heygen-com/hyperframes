import { describe, expect, it, vi } from "vitest";

const acornParse = vi.hoisted(() => ({ calls: 0 }));
vi.mock("acorn", async (importOriginal) => {
  const actual = await importOriginal<typeof import("acorn")>();
  return {
    ...actual,
    parse: (...args: Parameters<typeof actual.parse>) => {
      acornParse.calls += 1;
      return actual.parse(...args);
    },
  };
});

const { parseGsapScriptAcorn } = await import("./gsapParserAcorn");

const SCRIPT = `const tl = gsap.timeline({ paused: true });
tl.to("#a", { x: 100, duration: 1 }, 0);`;

describe("parseGsapScriptAcorn memo", () => {
  it("parses identical source once and hands every caller its own copy", () => {
    const first = parseGsapScriptAcorn(SCRIPT);
    const callsAfterFirst = acornParse.calls;
    first.animations[0]!.duration = 99;

    const second = parseGsapScriptAcorn(SCRIPT);

    expect(acornParse.calls).toBe(callsAfterFirst);
    expect(second.animations[0]!.duration).toBe(1);
    expect(parseGsapScriptAcorn(`${SCRIPT}\ntl.to("#b", { y: 5 }, 1);`).animations).toHaveLength(2);
    expect(acornParse.calls).toBeGreaterThan(callsAfterFirst);
  });
});
