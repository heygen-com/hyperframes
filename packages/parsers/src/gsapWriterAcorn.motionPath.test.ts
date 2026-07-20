import { describe, expect, it } from "vitest";
import {
  addMotionPathPointInScript as addAcorn,
  addMotionPathToScript as addPathAcorn,
  removeMotionPathPointInScript as removeAcorn,
  syncPositionHoldsBeforeKeyframes as syncAcorn,
  updateMotionPathPointInScript as updateAcorn,
} from "./gsapWriterAcorn.js";
import {
  addMotionPathPointInScript as addRecast,
  addMotionPathToScript as addPathRecast,
  parseGsapScript,
  removeMotionPathPointInScript as removeRecast,
  syncPositionHoldsBeforeKeyframes as syncRecast,
  updateMotionPathPointInScript as updateRecast,
} from "./gsapParser.js";
import { parseGsapScriptAcorn } from "./gsapParserAcorn.js";

const SCRIPT = `// keep-this-comment
const untouched = { spacing: "verbatim" };
const tl = gsap.timeline({ paused: true });
tl.to("#box", { motionPath: { path: [{ x: 0, y: 0 }, { x: 100, y: -50 }, { x: 200, y: 0 }], curviness: 1.2 }, duration: 1 }, 2);
window.__timelines = { main: tl };`;

function idOf(script: string): string {
  const id = parseGsapScript(script).animations.find((animation) => animation.arcPath)?.id;
  if (!id) throw new Error("motion path fixture did not parse");
  return id;
}

function motionModel(script: string) {
  return parseGsapScriptAcorn(script).animations.map((animation) => ({
    targetSelector: animation.targetSelector,
    method: animation.method,
    position: animation.position,
    duration: animation.duration,
    ease: animation.ease,
    keyframes: animation.keyframes,
    arcPath: animation.arcPath,
  }));
}

function expectParity(acorn: string, recast: string): void {
  expect(motionModel(acorn)).toEqual(motionModel(recast));
  expect(acorn).toContain("// keep-this-comment");
  expect(acorn).toContain('const untouched = { spacing: "verbatim" };');
}

describe("Acorn motion-path writer parity", () => {
  it("moves an anchor while preserving path semantics and untouched source", () => {
    const id = idOf(SCRIPT);
    expectParity(
      updateAcorn(SCRIPT, id, 1, { x: 120, y: -80 }),
      updateRecast(SCRIPT, id, 1, { x: 120, y: -80 }),
    );
  });

  it("adds and removes anchors with the same segment behavior as Recast", () => {
    const id = idOf(SCRIPT);
    expectParity(
      addAcorn(SCRIPT, id, 1, { x: 50, y: -20 }),
      addRecast(SCRIPT, id, 1, { x: 50, y: -20 }),
    );
    expectParity(removeAcorn(SCRIPT, id, 1), removeRecast(SCRIPT, id, 1));
  });

  it("authors a new path with the same parsed model", () => {
    const base = "const tl = gsap.timeline({ paused: true });\nwindow.__timelines = { main: tl };";
    const acorn = addPathAcorn(base, "#hero", 1.5, 2, { x: 300, y: -100 }).script;
    const recast = addPathRecast(base, "#hero", 1.5, 2, { x: 300, y: -100 }).script;
    expect(motionModel(acorn)).toEqual(motionModel(recast));
  });

  it("synchronizes delayed position holds without Recast and remains idempotent", () => {
    const acorn = syncAcorn(SCRIPT);
    const recast = syncRecast(SCRIPT);
    expect(motionModel(acorn)).toEqual(motionModel(recast));
    expect(acorn).toContain('data: "hf-hold"');
    expect(syncAcorn(acorn)).toBe(acorn);
  });
});
