import { describe, expect, it, vi } from "vitest";
import { parseGsapScript } from "@hyperframes/parsers";
import { addStaggeredEntrance } from "../examples/headless-agent.js";
import { addBounceIn, updateEase } from "../examples/react-embed.js";
import { addBounce, addFadeIn } from "../examples/vanilla-editor.js";
import { openComposition } from "./session.js";

const HTML =
  '<!DOCTYPE html>\n<html><head><style>html,body{margin:0} [data-hf-root]{width:640px;height:360px;background:#101820;color:#fff} #headline{position:absolute;left:80px;top:100px;font:48px Arial}</style></head>\n<body><section data-composition-id="example" data-hf-id="hf-stage" data-hf-root data-width="640" data-height="360" data-duration="2">\n<div id="headline" class="clip" data-hf-id="hf-text" data-start="0" data-duration="2" data-track-index="0">SDK example</div>\n{{SCRIPT}}\n</section></body></html>';
const SCRIPT =
  '<script>var tl = gsap.timeline({ paused: true }); tl.to("#headline", { x: 0, duration: 2 }, 0); window.__timelines = { example: tl };</script>';
const GSAP_HTML = HTML.replace("{{SCRIPT}}", SCRIPT);
const STATIC_HTML = HTML.replace("{{SCRIPT}}", "");

const helpers = [
  { name: "vanilla fade", add: addFadeIn, properties: { opacity: 0 }, duration: 0.4 },
  { name: "vanilla bounce", add: addBounce, properties: { y: 60, opacity: 0 }, duration: 0.6 },
  { name: "React bounce", add: addBounceIn, properties: { y: 40, opacity: 0 }, duration: 0.5 },
];

describe("SDK animation examples", () => {
  it.each(helpers)("$name skips compositions without a GSAP script", async ({ add }) => {
    const comp = await openComposition(STATIC_HTML);
    const before = comp.serialize();
    try {
      expect(add(comp, "hf-text")).toBeNull();
      expect(comp.serialize()).toBe(before);
    } finally {
      comp.dispose();
    }
  });

  it.each(helpers)("$name skips targets missing from a GSAP composition", async ({ add }) => {
    const comp = await openComposition(GSAP_HTML);
    const before = comp.serialize();
    try {
      expect(add(comp, "hf-missing")).toBeNull();
      expect(comp.serialize()).toBe(before);
    } finally {
      comp.dispose();
    }
  });

  it.each(helpers)(
    "$name emits an entrance tween with starting values",
    async ({ add, properties, duration }) => {
      const comp = await openComposition(GSAP_HTML);
      try {
        const animationId = add(comp, "hf-text");
        expect(animationId).toBeTruthy();
        const scripts = /<script>([\s\S]*?)<\/script>/.exec(comp.serialize());
        const animations = parseGsapScript(scripts?.[1] ?? "").animations;
        expect(animations.find((animation) => animation.id === animationId)).toMatchObject({
          method: "from",
          properties,
          duration,
        });
      } finally {
        comp.dispose();
      }
    },
  );

  it("the headless agent skips a composition without a writable timeline", async () => {
    const expected = await openComposition(STATIC_HTML);
    try {
      expect(await addStaggeredEntrance(STATIC_HTML)).toBe(expected.serialize());
    } finally {
      expected.dispose();
    }
  });

  it("the headless agent preserves stagger positions and starting values", async () => {
    const html = GSAP_HTML.replace(
      "</section>",
      '<div data-hf-id="hf-second">Second</div></section>',
    );
    const output = await addStaggeredEntrance(html, 0.25);
    const script = /<script>([\s\S]*?)<\/script>/.exec(output);
    const entrances = parseGsapScript(script?.[1] ?? "").animations.filter(
      (animation) => animation.method === "from",
    );
    expect(entrances).toHaveLength(2);
    expect(entrances.map((animation) => animation.position)).toEqual([0, 0.25]);
    for (const animation of entrances)
      expect(animation.properties).toMatchObject({ opacity: 0, y: 30 });
  });

  it("the React easing control skips unsupported edits", async () => {
    const comp = await openComposition(STATIC_HTML);
    const dispatch = vi.spyOn(comp, "setGsapTween");
    try {
      expect(() => updateEase(comp, "missing", "power2.in")).not.toThrow();
      expect(dispatch).not.toHaveBeenCalled();
    } finally {
      comp.dispose();
    }
  });

  it("the React easing control updates an existing animation", async () => {
    const comp = await openComposition(GSAP_HTML);
    try {
      const animationId = addBounceIn(comp, "hf-text");
      expect(animationId).toBeTruthy();
      if (!animationId) return;
      updateEase(comp, animationId, "power2.in");
      const script = /<script>([\s\S]*?)<\/script>/.exec(comp.serialize());
      expect(
        parseGsapScript(script?.[1] ?? "").animations.find(
          (animation) => animation.id === animationId,
        )?.ease,
      ).toBe("power2.in");
    } finally {
      comp.dispose();
    }
  });
});
