import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAnimeJsScriptAcorn } from "./animejsParserAcorn.js";
import {
  addAnimeJsAnimationToScript,
  removeAnimeJsAnimationFromScript,
  retargetAnimeJsAnimationInScript,
  splitAnimeJsAnimationsInScript,
  updateAnimeJsAnimationInScript,
  updateAnimeJsPropertyKeyframeInScript,
} from "./animejsWriterAcorn.js";

const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, "__goldens__", "animejs", name), "utf-8");

function firstId(script: string): string {
  return parseAnimeJsScriptAcorn(script).animations[0]!.id;
}

describe("anime.js acorn writer", () => {
  it("is byte-identical for a no-op update", () => {
    const script = fixture("simple-timeline.js");
    expect(updateAnimeJsAnimationInScript(script, firstId(script), {})).toBe(script);
  });

  it("changes duration by touching only the duration value", () => {
    const script = fixture("simple-timeline.js");
    const id = firstId(script);
    const out = updateAnimeJsAnimationInScript(script, id, { duration: 750 });

    expect(out).toBe(script.replace("duration: 600", "duration: 750"));
    expect(parseAnimeJsScriptAcorn(out).animations[0]!.duration).toBe(750);
  });

  it("retargets a selector by touching only the target argument", () => {
    const script = fixture("simple-timeline.js");
    const id = firstId(script);
    const out = retargetAnimeJsAnimationInScript(script, id, ".headline");

    expect(out).toBe(script.replace('".hero"', '".headline"'));
    expect(parseAnimeJsScriptAcorn(out).animations[0]!.targetSelector).toBe(".headline");
  });

  it("inserts a tween at a label without reformatting existing source", () => {
    const script = fixture("labeled-sequence.js");
    const out = addAnimeJsAnimationToScript(script, {
      targetSelector: ".spark",
      method: "add",
      position: "reveal",
      properties: { opacity: [0, 1], translateY: -24 },
      duration: 220,
      ease: "outQuad",
    });

    expect(out).toContain(
      'tl.add(".spark", { opacity: [0, 1], translateY: -24, duration: 220, ease: "outQuad" }, "reveal");',
    );
    expect(
      out.replace(
        '\ntl.add(".spark", { opacity: [0, 1], translateY: -24, duration: 220, ease: "outQuad" }, "reveal");',
        "",
      ),
    ).toBe(script);
    expect(
      parseAnimeJsScriptAcorn(out).animations.some((anim) => anim.targetSelector === ".spark"),
    ).toBe(true);
  });

  it("deletes one tween and preserves the remaining bytes", () => {
    const script = fixture("labeled-sequence.js");
    const parsed = parseAnimeJsScriptAcorn(script);
    const id = parsed.animations.find((anim) => anim.targetSelector === ".badge")!.id;
    const out = removeAnimeJsAnimationFromScript(script, id);

    expect(out).not.toContain('tl.set(".badge"');
    expect(out).toContain('tl.add(".hero"');
    expect(out).toContain('tl.add(".cta"');
    expect(
      parseAnimeJsScriptAcorn(out).animations.map((anim) => anim.targetSelector),
    ).not.toContain(".badge");
  });

  it("edits a single per-property keyframe value in place", () => {
    const script = fixture("per-property-keyframes.js");
    const id = firstId(script);
    const out = updateAnimeJsPropertyKeyframeInScript(script, id, "scale", 0, { to: 1.4 });

    expect(out).toBe(script.replace("to: 1.2", "to: 1.4"));
    const scale = parseAnimeJsScriptAcorn(out).animations[0]!.propertyKeyframes?.scale;
    expect(scale?.[0]?.to).toBe(1.4);
    expect(scale?.[1]?.to).toBe(1);
  });

  it("refuses to edit runtime-dynamic values", () => {
    const script = `
const tl = anime.createTimeline({ autoplay: false });
tl.add(makeTarget(), buildParams(), 0);
`;
    const id = firstId(script);

    expect(() => retargetAnimeJsAnimationInScript(script, id, ".safe")).toThrow(
      /not statically editable/,
    );
    expect(() => updateAnimeJsAnimationInScript(script, id, { duration: 100 })).toThrow(
      /not statically editable/,
    );
  });

  it("retargets anime tweens wholly after a razor split", () => {
    const script = `
const tl = anime.createTimeline({ autoplay: false });
tl.add("#hero", { opacity: 1, duration: 400 }, 200);
tl.add("#hero", { translateX: 120, duration: 500, ease: "outQuad" }, 1300);
hyperframesAnime.register("main", tl);
`;

    const result = splitAnimeJsAnimationsInScript(script, {
      originalId: "hero",
      newId: "hero-split",
      splitTime: 1,
    });
    const selectors = parseAnimeJsScriptAcorn(result.script).animations.map(
      (anim) => anim.targetSelector,
    );

    expect(selectors).toEqual(["#hero", "#hero-split"]);
    expect(result.skippedSelectors).toEqual([]);
  });

  it("keeps spanning anime tweens on the original selector and reports them read-only", () => {
    const script = `
const tl = anime.createTimeline({ autoplay: false });
tl.add("#hero", { translateX: 120, duration: 1000 }, 500);
hyperframesAnime.register("main", tl);
`;

    const result = splitAnimeJsAnimationsInScript(script, {
      originalId: "hero",
      newId: "hero-split",
      splitTime: 0.75,
    });

    expect(parseAnimeJsScriptAcorn(result.script).animations[0]!.targetSelector).toBe("#hero");
    expect(result.skippedSelectors).toEqual(["#hero (anime tween spanning split)"]);
  });
});
