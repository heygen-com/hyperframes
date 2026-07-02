import { describe, it, expect } from "vitest";
import {
  parseGsapScript,
  updateAnimationInScript,
  addAnimationToScript,
  removeAnimationFromScript,
  addKeyframeToScript,
  removeAllKeyframesFromScript,
} from "./gsapParser.js";
import { addLabelToScript, removeLabelFromScript } from "./gsapWriterAcorn.js";

// U4: recast parser/writer parity for the inline form
// `window.__timelines["scene"] = gsap.timeline()` (the default server write path).

const inlineSrc = `window.__timelines = window.__timelines || {};
window.__timelines["scene"] = gsap.timeline({ paused: true });
window.__timelines["scene"].to("#a", { x: 100, duration: 1 }, 0);
window.__timelines["scene"].to("#b", { y: 50, duration: 1 }, 0.5);`;

describe("recast — inline timeline read", () => {
  it("reads inline tweens (double quote)", () => {
    const p = parseGsapScript(inlineSrc);
    expect(p.unsupportedTimelinePattern).toBeFalsy();
    expect(p.animations).toHaveLength(2);
    expect(p.animations[0]!.targetSelector).toBe("#a");
  });

  it("reads single-quote + dot access", () => {
    const sq = `window.__timelines['s'] = gsap.timeline();\nwindow.__timelines['s'].to('#a', { x: 1, duration: 1 }, 0);`;
    const dot = `window.__timelines.s = gsap.timeline();\nwindow.__timelines.s.to("#a", { x: 1, duration: 1 }, 0);`;
    expect(parseGsapScript(sq).animations).toHaveLength(1);
    expect(parseGsapScript(dot).animations).toHaveLength(1);
  });

  it("flags computed key as unsupported", () => {
    const c = `const id = "s";\nwindow.__timelines[id] = gsap.timeline();\nwindow.__timelines[id].to("#a", { x: 1, duration: 1 }, 0);`;
    expect(parseGsapScript(c).unsupportedTimelinePattern).toBe(true);
  });

  it("keeps the canonical const form unchanged", () => {
    const c = `const tl = gsap.timeline();\nwindow.__timelines["s"] = tl;\ntl.to("#a", { x: 5, duration: 1 }, 0);`;
    const p = parseGsapScript(c);
    expect(p.timelineVar).toBe("tl");
    expect(p.animations).toHaveLength(1);
  });
});

describe("recast — inline timeline write", () => {
  it("edits an inline tween in place", () => {
    const id = parseGsapScript(inlineSrc).animations[0]!.id;
    const out = updateAnimationInScript(inlineSrc, id, { properties: { x: 200 } });
    expect(out).toContain('window.__timelines["scene"].to("#a"');
    expect(out).toContain("200");
    expect(parseGsapScript(out).animations).toHaveLength(2);
  });

  it("adds a tween in member form", () => {
    const out = addAnimationToScript(inlineSrc, {
      method: "to",
      targetSelector: "#c",
      properties: { opacity: 1 },
      position: 1,
      duration: 1,
    });
    const script = typeof out === "string" ? out : out.script;
    expect(script).toContain('window.__timelines["scene"].to("#c"');
    expect(parseGsapScript(script).animations).toHaveLength(3);
  });

  it("removes an inline tween", () => {
    const id = parseGsapScript(inlineSrc).animations[1]!.id;
    const out = removeAnimationFromScript(inlineSrc, id);
    expect(out).not.toContain('"#b"');
    expect(parseGsapScript(out).animations).toHaveLength(1);
  });

  it("adds + removes keyframes on an inline tween", () => {
    const id = parseGsapScript(inlineSrc).animations[0]!.id;
    const withKf = addKeyframeToScript(inlineSrc, id, 50, { x: 150 });
    expect(withKf).toContain("keyframes");
    expect(parseGsapScript(withKf).unsupportedTimelinePattern).toBeFalsy();
    const kfId = parseGsapScript(withKf).animations[0]!.id;
    const cleared = removeAllKeyframesFromScript(withKf, kfId);
    expect(cleared).not.toContain("keyframes");
  });

  it("preserves single-quote member form on write", () => {
    const sq = `window.__timelines['s'] = gsap.timeline();\nwindow.__timelines['s'].to('#a', { x: 1, duration: 1 }, 0);`;
    const id = parseGsapScript(sq).animations[0]!.id;
    const out = updateAnimationInScript(sq, id, { properties: { x: 9 } });
    expect(out).toContain("window.__timelines['s']");
  });
});

// acorn writer: inline-form label add/remove must match member-rooted callees, not
// just Identifier-rooted ones — else addLabel duplicates and removeLabel no-ops.
describe("acorn — inline timeline labels", () => {
  const src = `window.__timelines["scene"] = gsap.timeline({ paused: true });
window.__timelines["scene"].to("#a", { x: 100, duration: 1 }, 0);`;

  it("dedups addLabel (moves, not duplicates) and removes it on an inline timeline", () => {
    let s = addLabelToScript(src, "intro", 0.5);
    s = addLabelToScript(s, "intro", 0.9);
    expect((s.match(/addLabel\(/g) ?? []).length).toBe(1);
    expect(s).toContain('addLabel("intro", 0.9)');
    expect((removeLabelFromScript(s, "intro").match(/addLabel\(/g) ?? []).length).toBe(0);
  });
});
