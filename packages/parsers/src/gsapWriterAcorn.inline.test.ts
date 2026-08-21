import { describe, it, expect } from "vitest";
import { parseGsapScriptAcorn } from "./gsapParserAcorn.js";
import {
  updateAnimationInScript,
  addAnimationToScript,
  removeAnimationFromScript,
  addKeyframeToScript,
  removeAllKeyframesFromScript,
} from "./gsapWriterAcorn.js";

// U3: edit/add/delete tweens on a timeline authored inline as
// `window.__timelines["scene"] = gsap.timeline()`, emitting the member form.

const inlineSrc = `window.__timelines = window.__timelines || {};
window.__timelines["scene"] = gsap.timeline({ paused: true });
window.__timelines["scene"].to("#a", { x: 100, duration: 1 }, 0);
window.__timelines["scene"].to("#b", { y: 50, duration: 1 }, 0.5);`;

describe("inline timeline assignment — write", () => {
  it("edits an existing inline tween's value in place", () => {
    const id = parseGsapScriptAcorn(inlineSrc).animations[0]!.id;
    const out = updateAnimationInScript(inlineSrc, id, { properties: { x: 200 } });
    expect(out).toContain('window.__timelines["scene"].to("#a"');
    expect(out).toContain("200");
    const reread = parseGsapScriptAcorn(out);
    expect(reread.animations).toHaveLength(2);
    expect(reread.unsupportedTimelinePattern).toBeFalsy();
  });

  it("adds a new tween in the member form", () => {
    const { script: out } = addAnimationToScript(inlineSrc, {
      method: "to",
      targetSelector: "#c",
      properties: { opacity: 1 },
      position: 1,
      duration: 1,
    });
    expect(out).toContain('window.__timelines["scene"].to("#c"');
    expect(parseGsapScriptAcorn(out).animations).toHaveLength(3);
  });

  it("removes an inline tween, leaving the rest", () => {
    const id = parseGsapScriptAcorn(inlineSrc).animations[1]!.id;
    const out = removeAnimationFromScript(inlineSrc, id);
    expect(out).not.toContain('"#b"');
    expect(parseGsapScriptAcorn(out).animations).toHaveLength(1);
  });

  it("preserves single-quote member form on write", () => {
    const sq = `window.__timelines = window.__timelines || {};
window.__timelines['scene'] = gsap.timeline();
window.__timelines['scene'].to('#a', { x: 1, duration: 1 }, 0);`;
    const id = parseGsapScriptAcorn(sq).animations[0]!.id;
    const out = updateAnimationInScript(sq, id, { properties: { x: 9 } });
    expect(out).toContain("window.__timelines['scene']");
    expect(parseGsapScriptAcorn(out).animations).toHaveLength(1);
  });

  it("converts an inline tween to keyframes by adding one (the delete-all-keyframes bug area)", () => {
    const id = parseGsapScriptAcorn(inlineSrc).animations[0]!.id;
    const out = addKeyframeToScript(inlineSrc, id, 50, { x: 150 });
    expect(out).toContain("keyframes");
    expect(out).toContain('window.__timelines["scene"]');
    expect(parseGsapScriptAcorn(out).unsupportedTimelinePattern).toBeFalsy();
  });

  it("removes all keyframes from an inline keyframed tween", () => {
    const kf = `window.__timelines = window.__timelines || {};
window.__timelines["scene"] = gsap.timeline();
window.__timelines["scene"].to("#a", { keyframes: { "0%": { x: 0 }, "100%": { x: 100 } }, duration: 1 }, 0);`;
    const id = parseGsapScriptAcorn(kf).animations[0]!.id;
    const out = removeAllKeyframesFromScript(kf, id);
    expect(out).not.toContain("keyframes");
    // Static hold (gsap.set equivalent): zero duration + immediateRender so the
    // element does not re-animate after collapse.
    const anim = parseGsapScriptAcorn(out).animations[0]!;
    expect(anim.duration).toBe(0);
    expect(anim.extras?.immediateRender).toBe("__raw:true");
  });

  it("adds the first tween to an empty inline timeline", () => {
    const empty = `window.__timelines = window.__timelines || {};
window.__timelines["scene"] = gsap.timeline({ paused: true });`;
    const { script: out } = addAnimationToScript(empty, {
      method: "to",
      targetSelector: "#a",
      properties: { x: 10 },
      position: 0,
      duration: 1,
    });
    expect(out).toContain('window.__timelines["scene"].to("#a"');
    expect(parseGsapScriptAcorn(out).animations).toHaveLength(1);
  });

  it("no-op write is stable (read → re-emit same → re-read equal count)", () => {
    const parsed = parseGsapScriptAcorn(inlineSrc);
    const id = parsed.animations[0]!.id;
    const out = updateAnimationInScript(inlineSrc, id, {
      properties: parsed.animations[0]!.properties,
    });
    expect(parseGsapScriptAcorn(out).animations).toHaveLength(2);
  });
});

describe("no duplicate vars keys on rewrite", () => {
  const setSrc = `window.__timelines = window.__timelines || {};
const tl = gsap.timeline({ paused: true });
tl.set("#a", { z: 0, rotationX: 5, immediateRender: true }, 0);
window.__timelines["main"] = tl;`;

  it("update with immediateRender riding in newProps emits the key once", () => {
    const id = parseGsapScriptAcorn(setSrc).animations[0]!.id;
    // Studio paths that build props off live tween vars carry the flag along.
    const out = updateAnimationInScript(setSrc, id, {
      properties: { z: 0, rotationX: 9, immediateRender: "__raw:true" },
    });
    expect(out).toContain("rotationX: 9");
    expect(out.match(/immediateRender/g)).toHaveLength(1);
  });

  it("addAnimationToScript dedupes a key present in both properties and extras", () => {
    const { script: out } = addAnimationToScript(setSrc, {
      targetSelector: "#b",
      method: "set",
      position: 0,
      properties: { scale: 1, immediateRender: "__raw:true" },
      extras: { immediateRender: "__raw:true" },
    });
    const setB = out.split("\n").find((l) => l.includes('"#b"'));
    expect(setB?.match(/immediateRender/g)).toHaveLength(1);
  });
});
