// fallow-ignore-file code-duplication
/**
 * T6b — acorn vs golden differential harness.
 *
 * Each corpus script runs through `parseGsapScriptAcorn` and must produce
 * output identical to the T6a golden files (captured from the recast/babel
 * baseline). Any mismatch = fidelity bug in the acorn port to fix before
 * recast is removed.
 *
 * Also includes the targeted preservation test (comments, custom JS, postamble)
 * and a coverage check against the fromTo / chained-call patterns.
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseGsapScriptAcorn } from "./gsapParserAcorn.js";

const __goldens__ = join(fileURLToPath(import.meta.url), "..", "__goldens__");
const g = (name: string) => join(__goldens__, name);

// ---------------------------------------------------------------------------
// Corpus scripts — identical to gsapParser.golden.test.ts so goldens are shared
// ---------------------------------------------------------------------------

const MINIMAL_SCRIPT = `\
var tl = gsap.timeline({ paused: true });
var notification = document.getElementById("notification");
gsap.set(notification, { x: 420, opacity: 0 });
tl.to(notification, { x: 0, opacity: 1, duration: 0.5, ease: "power3.out" }, 0.2);
tl.to(notification, { x: 420, opacity: 0, duration: 0.3, ease: "power3.in" }, 4.2);
window.__timelines["macos-notification"] = tl;`;

const MODERATE_SCRIPT = `\
window.__timelines = window.__timelines || {};
var tl = gsap.timeline({ paused: true });
var card = document.getElementById("card");
var btn = document.getElementById("subscribe-btn");
var textSub = document.getElementById("btn-subscribe");
var textSubd = document.getElementById("btn-subscribed");
gsap.set(card, { y: 300, opacity: 0 });
tl.to(card, { y: 0, opacity: 1, duration: 0.5, ease: "power3.out" }, 0.1);
tl.to(btn, { scale: 0.92, duration: 0.15, ease: "power2.out" }, 1.0);
tl.to(btn, { scale: 1, duration: 0.4, ease: "elastic.out(1, 0.4)" }, 1.15);
tl.to(textSub, { opacity: 0, duration: 0.08, ease: "none" }, 1.15);
tl.to(textSubd, { opacity: 1, duration: 0.08, ease: "none" }, 1.18);
tl.to(card, { y: 300, opacity: 0, duration: 0.25, ease: "power3.in" }, 3.8);
window.__timelines["yt-lower-third"] = tl;`;

const COMPLEX_SCRIPT = `\
window.__timelines = window.__timelines || {};
gsap.defaults({ force3D: true });
const tl = gsap.timeline({ paused: true, defaults: { duration: 0.45, ease: "power3.out" } });
tl.from(".headline span", { y: 46, opacity: 0, stagger: 0.055, duration: 0.38, ease: "back.out(1.35)" }, 0.05)
  .from(".headline .sub", { y: 20, opacity: 0, duration: 0.28 }, 0.2)
  .from(".ambient-word", { scale: 0.92, opacity: 0, duration: 0.5 }, 0.08)
  .from(".ambient-line", { scaleX: 0, opacity: 0, stagger: 0.08, duration: 0.42 }, 0.16);
window.__timelines["vpn-youtube-spot"] = tl;`;

const FROMTO_SCRIPT = `\
var tl = gsap.timeline({ paused: true });
var hero = document.getElementById("hero");
var caption = document.getElementById("caption");
tl.fromTo(hero, { x: -200, opacity: 0 }, { x: 0, opacity: 1, duration: 0.6, ease: "power3.out" }, 0.1);
tl.fromTo(caption, { y: -30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45 }, 0.5);
window.__timelines["hero-reveal"] = tl;`;

// ---------------------------------------------------------------------------
// T6b differential: acorn output must match T6a golden files
// ---------------------------------------------------------------------------

describe("T6b — acorn vs recast golden differential", () => {
  it("minimal — matches golden (macos-notification)", async () => {
    const result = parseGsapScriptAcorn(MINIMAL_SCRIPT);
    await expect(JSON.stringify(result, null, 2)).toMatchFileSnapshot(g("minimal.parsed.json"));
  });

  it("moderate — matches golden (yt-lower-third)", async () => {
    const result = parseGsapScriptAcorn(MODERATE_SCRIPT);
    await expect(JSON.stringify(result, null, 2)).toMatchFileSnapshot(g("moderate.parsed.json"));
  });

  it("complex — matches golden (vpn-youtube-spot, chained .from() calls)", async () => {
    const result = parseGsapScriptAcorn(COMPLEX_SCRIPT);
    await expect(JSON.stringify(result, null, 2)).toMatchFileSnapshot(g("complex.parsed.json"));
  });

  it("fromTo — matches golden (hero-reveal, negative positions)", async () => {
    const result = parseGsapScriptAcorn(FROMTO_SCRIPT);
    await expect(JSON.stringify(result, null, 2)).toMatchFileSnapshot(g("fromto.parsed.json"));
  });
});

// ---------------------------------------------------------------------------
// T6b preservation test — the acorn claim: untouched code survives verbatim
// ---------------------------------------------------------------------------

describe("T6b — preservation (comments, custom JS, postamble)", () => {
  it("preserves preamble and postamble around tween calls", () => {
    const script = `
// author comment preserved
const tl = gsap.timeline({ paused: true });
tl.to('#hero', { opacity: 1, duration: 0.5, ease: 'power2.out' });
window.__timelines['scene'] = tl;
`.trim();
    const result = parseGsapScriptAcorn(script);
    expect(result.preamble).toContain("// author comment preserved");
    expect(result.preamble).toContain("gsap.timeline");
    expect(result.postamble).toContain("window.__timelines");
    expect(result.postamble).toContain("scene");
  });

  it("extracts correct animation from script with custom JS around tweens", () => {
    const script = `
var tl = gsap.timeline({ paused: true });
var el = document.querySelector('.box');
console.log('before tween');
tl.to(el, { x: 100, duration: 0.5 }, 0);
console.log('after tween');
window.__timelines['custom'] = tl;
`.trim();
    const result = parseGsapScriptAcorn(script);
    expect(result.animations).toHaveLength(1);
    expect(result.animations[0]?.targetSelector).toBe(".box");
    expect(result.animations[0]?.properties.x).toBe(100);
    expect(result.postamble).toContain("window.__timelines");
  });
});

// ---------------------------------------------------------------------------
// T6b structural coverage — patterns exercised by existing corpus
// ---------------------------------------------------------------------------

describe("T6b — structural coverage", () => {
  it("resolves getElementById targets", () => {
    const script = `
var tl = gsap.timeline({ paused: true });
var hero = document.getElementById("hero");
tl.to(hero, { opacity: 1, duration: 0.5 }, 0);
window.__timelines['t'] = tl;
`.trim();
    const result = parseGsapScriptAcorn(script);
    expect(result.animations[0]?.targetSelector).toBe("#hero");
  });

  it("resolves querySelector targets", () => {
    const script = `
var tl = gsap.timeline({ paused: true });
var el = document.querySelector(".box");
tl.to(el, { x: 50, duration: 0.3 }, 0);
window.__timelines['t'] = tl;
`.trim();
    const result = parseGsapScriptAcorn(script);
    expect(result.animations[0]?.targetSelector).toBe(".box");
  });

  it("handles stagger as __raw: extra", () => {
    const script = `
var tl = gsap.timeline({ paused: true });
tl.from(".item", { y: 20, opacity: 0, stagger: 0.1, duration: 0.4 }, 0);
window.__timelines['t'] = tl;
`.trim();
    const result = parseGsapScriptAcorn(script);
    const anim = result.animations[0];
    expect(anim?.extras?.stagger).toBe("__raw:0.1");
    expect(anim?.properties).not.toHaveProperty("stagger");
  });

  it("handles stagger as __raw: when expressed as object", () => {
    const script = `
var tl = gsap.timeline({ paused: true });
tl.from(".item", { y: 20, stagger: { each: 0.1, from: "start" }, duration: 0.4 }, 0);
window.__timelines['t'] = tl;
`.trim();
    const result = parseGsapScriptAcorn(script);
    const extras = result.animations[0]?.extras;
    const stagger = extras?.stagger;
    expect(typeof stagger).toBe("string");
    expect(typeof stagger === "string" && stagger.startsWith("__raw:")).toBe(true);
    expect(stagger).toContain("each");
  });

  it("drops dropped keys (onComplete, onStart, onUpdate, onRepeat)", () => {
    const script = `
var tl = gsap.timeline({ paused: true });
tl.to(".box", { x: 100, duration: 0.5, onComplete: function() {}, onStart: function() {}, onUpdate: function() {}, onRepeat: function() {} }, 0);
window.__timelines['t'] = tl;
`.trim();
    const result = parseGsapScriptAcorn(script);
    const anim = result.animations[0];
    expect(anim?.properties).not.toHaveProperty("onComplete");
    expect(anim?.properties).not.toHaveProperty("onStart");
    expect(anim?.properties).not.toHaveProperty("onUpdate");
    expect(anim?.properties).not.toHaveProperty("onRepeat");
    expect(anim?.extras).toBeUndefined();
  });

  it("assigns stable IDs based on selector + method + position", () => {
    const script = `
var tl = gsap.timeline({ paused: true });
tl.to(".a", { x: 1, duration: 0.5 }, 0);
tl.to(".a", { x: 2, duration: 0.5 }, 0);
window.__timelines['t'] = tl;
`.trim();
    const result = parseGsapScriptAcorn(script);
    expect(result.animations[0]?.id).toBe(".a-to-0-position");
    expect(result.animations[1]?.id).toBe(".a-to-0-position-2");
  });

  it("returns empty result on syntax error (graceful fail)", () => {
    const result = parseGsapScriptAcorn("this is not valid js {{{{");
    expect(result.animations).toHaveLength(0);
    expect(result.timelineVar).toBe("tl");
  });

  it("detects multipleTimelines when script has >1 timeline", () => {
    const script = `
var tl1 = gsap.timeline({ paused: true });
var tl2 = gsap.timeline({ paused: true });
tl1.to(".a", { x: 1, duration: 0.5 }, 0);
window.__timelines['t'] = tl1;
`.trim();
    const result = parseGsapScriptAcorn(script);
    expect(result.multipleTimelines).toBe(true);
  });
});
