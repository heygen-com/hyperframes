import { describe, expect, it } from "vitest";
import { resolveMediaStartSeconds } from "./mediaTiming";

const ordinary = () => 99;
const base = { authoredStart: 3, hostStart: 10, hasAutoStart: false, ordinaryStart: ordinary };

describe("resolveMediaStartSeconds", () => {
  it("adds the host start to a literal start by default", () => {
    expect(resolveMediaStartSeconds(base)).toBe(13);
  });

  it("keeps a legacy root-global start as is", () => {
    expect(resolveMediaStartSeconds({ ...base, basis: "global" })).toBe(3);
  });

  it.each([
    ["no literal start", { authoredStart: null }],
    ["an auto-injected start", { hasAutoStart: true }],
    ["a host at t=0", { hostStart: 0 }],
  ])("defers to ordinary resolution for %s", (_name, override) => {
    expect(resolveMediaStartSeconds({ ...base, ...override })).toBe(99);
  });
});
