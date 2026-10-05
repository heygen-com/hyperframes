import { describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({ parse: [] as string[], shape: [] as string[] }));

vi.mock("@hyperframes/parsers/gsap-parser-acorn", async (importOriginal) => {
  const real = await importOriginal<typeof import("@hyperframes/parsers/gsap-parser-acorn")>();
  return {
    ...real,
    parseGsapScriptAcorn: (code: string) => (
      reads.parse.push(code), real.parseGsapScriptAcorn(code)
    ),
    scriptShape: (code: string, mask?: boolean) => (
      reads.shape.push(code), real.scriptShape(code, mask)
    ),
  };
});

const { planLiveRetime } = await import("./gsapLiveRetime");

const at = (start: number) =>
  `var tl = gsap.timeline({ paused: true });\ntl.to("#a", { x: 1, duration: 1 }, ${start});\nwindow.__timelines["t"] = tl;`;

describe("planLiveRetime", () => {
  it("reads each script once across two drags in a row", () => {
    expect(planLiveRetime(at(0), at(1)).kind).toBe("retime");
    expect(planLiveRetime(at(1), at(2)).kind).toBe("retime");

    expect(reads.parse).toEqual([at(0), at(1), at(2)]);
    expect(reads.shape).toEqual([at(0), at(1), at(2)]);
  });
});
