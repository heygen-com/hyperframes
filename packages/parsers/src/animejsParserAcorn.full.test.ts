import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  extractAnimeJsLabels,
  parseAnimeJsScriptAcorn,
  parseAnimeJsScriptAcornForWrite,
} from "./animejsParserAcorn.js";
import { classifyAnimeJsTweenPropertyGroup } from "./animejsConstants.js";

const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, "__goldens__", "animejs", name), "utf-8");

describe("parseAnimeJsScriptAcorn", () => {
  it("parses a registered createTimeline with add, set, label, stagger, eases, and positions", () => {
    const script = `
      const targetsVar = ".tile";
      const tl = anime.createTimeline({ autoplay: false, defaults: { ease: "outQuad" } });
      tl.add(".hero", { opacity: [0, 1], translateX: 100, duration: 600, ease: "outCubic" }, 0);
      tl.add(".chip", { scale: [{ to: 1.2, duration: 200 }, { to: 1, duration: 300, ease: "outBack" }] }, "<");
      tl.label("reveal", 400);
      tl.set(".badge", { opacity: 1 }, "reveal");
      tl.add(targetsVar, { translateY: anime.stagger(20), duration: 500 }, "+=100");
      hyperframesAnime.register("scene", tl, { labels: { intro: 0, reveal: 0.4 } });
    `;

    const result = parseAnimeJsScriptAcorn(script);

    expect(result.engine).toBe("animejs");
    expect(result.timelineVar).toBe("tl");
    expect(result.registered).toBe(true);
    expect(result.registrationIds).toEqual(["scene"]);
    expect(result.labels).toEqual({ reveal: 400, intro: 0 });
    expect(result.animations).toHaveLength(5);

    const hero = result.animations[0]!;
    expect(hero.engine).toBe("animejs");
    expect(hero.method).toBe("add");
    expect(hero.targetSelector).toBe(".hero");
    expect(hero.targets).toEqual([".hero"]);
    expect(hero.properties.opacity).toEqual([0, 1]);
    expect(hero.properties.translateX).toBe(100);
    expect(hero.duration).toBe(600);
    expect(hero.ease).toBe("outCubic");
    expect(hero.position).toBe(0);
    expect(hero.resolvedStart).toBe(0);
    expect(hero.propertyGroup).toBeUndefined();

    const chip = result.animations[1]!;
    expect(chip.method).toBe("add");
    expect(chip.position).toBe("<");
    expect(chip.resolvedStart).toBe(0);
    expect(chip.propertyKeyframes?.scale).toEqual([
      { to: 1.2, duration: 200 },
      { to: 1, duration: 300, ease: "outBack" },
    ]);
    expect(chip.duration).toBe(500);
    expect(chip.propertyGroup).toBe("scale");

    const label = result.animations[2]!;
    expect(label.method).toBe("label");
    expect(label.label).toBe("reveal");
    expect(label.position).toBe(400);
    expect(label.duration).toBe(0);

    const badge = result.animations[3]!;
    expect(badge.method).toBe("set");
    expect(badge.position).toBe("reveal");
    expect(badge.resolvedStart).toBe(400);

    const tiles = result.animations[4]!;
    expect(tiles.targetSelector).toBe(".tile");
    expect(tiles.properties.translateY).toBe("__raw:anime.stagger(20)");
    expect(tiles.extras?.translateY).toBe("__raw:anime.stagger(20)");
    expect(tiles.provenance?.kind).toBe("runtime-dynamic");
    expect(tiles.resolvedStart).toBe(700);
  });

  it("parses standalone anime.animate calls registered directly", () => {
    const script = `
      const pulse = anime.animate([".dot", ".ring"], {
        opacity: [0, 1],
        rotate: "1turn",
        duration: 1200,
        ease: "inOutBack(1.7)"
      });
      hyperframesAnime.register("pulse", pulse);
    `;

    const result = parseAnimeJsScriptAcorn(script);

    expect(result.timelineVar).toBe("pulse");
    expect(result.registered).toBe(true);
    expect(result.animations).toHaveLength(1);
    expect(result.animations[0]!).toMatchObject({
      engine: "animejs",
      method: "animate",
      targetSelector: ".dot, .ring",
      targets: [".dot", ".ring"],
      duration: 1200,
      ease: "inOutBack(1.7)",
      registered: true,
    });
  });

  it("resolves targets from query selectors, arrays, and bound identifiers", () => {
    const script = `
      const hero = document.querySelector("#hero");
      const chips = [".chip-a", ".chip-b"];
      const tl = anime.createTimeline({ autoplay: false });
      tl.add(hero, { opacity: 1, duration: 100 }, 0);
      tl.add(chips, { translateY: [20, 0], duration: 200 }, 100);
    `;

    const result = parseAnimeJsScriptAcorn(script);

    expect(result.animations[0]!.targetSelector).toBe("#hero");
    expect(result.animations[1]!.targets).toEqual([".chip-a", ".chip-b"]);
  });

  it("keeps native, parameterized, and CustomEase path ease strings opaque", () => {
    const script = `
      const tl = anime.createTimeline({ autoplay: false });
      tl.add(".native", { opacity: 1, duration: 300, ease: "outQuad" }, 0);
      tl.add(".param", { opacity: 1, duration: 300, ease: "outElastic(1,0.3)" }, 300);
      tl.add(".path", { opacity: 1, duration: 300, ease: "M0,0 C0.2,0 0.8,1 1,1" }, 600);
    `;

    const result = parseAnimeJsScriptAcorn(script);

    expect(result.animations.map((anim) => anim.ease)).toEqual([
      "outQuad",
      "outElastic(1,0.3)",
      "M0,0 C0.2,0 0.8,1 1,1",
    ]);
  });

  it("flags unresolved selectors and dynamic params as non-editable instead of guessing", () => {
    const script = `
      const tl = anime.createTimeline({ autoplay: false });
      tl.add(makeTarget(), buildParams(), 0);
    `;

    const result = parseAnimeJsScriptAcorn(script);

    expect(result.animations).toHaveLength(1);
    expect(result.animations[0]!.targetSelector).toBe("__unresolved__");
    expect(result.animations[0]!.hasUnresolvedSelector).toBe(true);
    expect(result.animations[0]!.hasUnresolvedProperties).toBe(true);
    expect(result.animations[0]!.provenance?.kind).toBe("runtime-dynamic");
  });

  it("returns located calls for writer operations", () => {
    const script = fixture("per-property-keyframes.js");
    const parsed = parseAnimeJsScriptAcornForWrite(script);

    expect(parsed?.located).toHaveLength(1);
    expect(parsed?.located[0]!.animation.propertyKeyframes?.scale).toHaveLength(2);
    expect(parsed?.located[0]!.call.targetArg.type).toBe("Literal");
    expect(parsed?.located[0]!.call.paramsArg.type).toBe("ObjectExpression");
  });

  it("extracts numeric labels in source order", () => {
    const labels = extractAnimeJsLabels(fixture("labeled-sequence.js"));
    expect(labels).toEqual([
      { name: "intro", position: 0 },
      { name: "reveal", position: 400 },
      { name: "outro", position: 900 },
    ]);
  });

  it("classifies anime.js property groups", () => {
    expect(classifyAnimeJsTweenPropertyGroup({ translateX: 100, opacity: 1 })).toBeUndefined();
    expect(classifyAnimeJsTweenPropertyGroup({ translateX: 100, translateY: 20 })).toBe("position");
    expect(classifyAnimeJsTweenPropertyGroup({ scale: 1.2 })).toBe("scale");
  });

  it("parses the synthetic golden corpus without crashing", () => {
    for (const name of [
      "simple-timeline.js",
      "stagger-grid.js",
      "per-property-keyframes.js",
      "labeled-sequence.js",
      "dense-stress.js",
    ]) {
      const parsed = parseAnimeJsScriptAcorn(fixture(name));
      expect(parsed.engine).toBe("animejs");
      expect(parsed.animations.length).toBeGreaterThan(0);
    }
  });
});
