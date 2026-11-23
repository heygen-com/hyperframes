import { beforeAll, expect, it } from "vitest";
import { ensureDOMParser } from "../utils/dom.js";
import { surfaceComposition } from "./keyframes.js";
beforeAll(() => ensureDOMParser());
const surface = (script: string, dom = '<div id="dot"></div>') =>
  surfaceComposition(
    `<html><body>${dom}<script>const tl = gsap.timeline({paused:true});${script}</script></body></html>`,
    "main",
    "index.html",
  );
it("preserves known starts and exposes unknown starts", () => {
  const r = surface('tl.set("#dot",{scale:1.18},0);tl.to("#dot",{scale:.95,duration:.11},1.96);');
  expect(r.tweens[1]?.keyframes[0]?.properties.scale).toBe(1.18);
  expect(
    surface('tl.to("#dot",{x:50,duration:1},0);').tweens[0]?.keyframes[0]?.properties.x,
  ).toBeUndefined();
});
it("does not turn an unresolved expression into time zero", () => {
  const r = surface(
    'tl.to("#a",{x:1,duration:1},ts[i]);tl.to("#b",{x:2,duration:1});tl.to("#b",{x:3,duration:1},4);',
    '<div id="a"></div><div id="b"></div>',
  );
  expect(r.tweens[0]?.start).toBeNull();
  expect(r.tweens[1]?.start).toBeNull();
  expect(r.tweens[1]?.unresolved).toContain("start");
  expect(r.tweens[2]?.start).toBe(4);
});
it("reports a staggered from rest pose as unresolved", () => {
  const tween = surface(
    'tl.from(".item",{y:40,opacity:0,duration:.5,stagger:.1});',
    '<div class="item"></div>'.repeat(3),
  ).tweens[0];
  expect(tween?.keyframes.at(-1)?.properties.y).toBeUndefined();
  expect(tween?.keyframes.at(-1)?.properties.opacity).toBeUndefined();
  expect(tween?.unresolved).toContain("endpointProperties");
});
it("resolves string selector constants", () => {
  expect(surface('const b="#dot";tl.to(b,{x:50,duration:1},0);').tweens[0]?.target).toBe("#dot");
});
it("accounts for stagger and repetitions", () => {
  const r = surface(
    'tl.to(".dot",{opacity:0,duration:.2,stagger:.014,repeat:1,yoyo:true},1);',
    '<div class="dot"></div>'.repeat(3),
  );
  expect(r.tweens[0]?.end).toBeCloseTo(1.456);
});
it("does not call a small parent scale change static", () => {
  const r = surface(
    'tl.fromTo("#parent",{scale:1},{scale:1.16,duration:1},0);tl.to("#dot",{x:50,duration:1},0);',
    '<div id="parent"><div id="dot"></div></div>',
  );
  expect(r.tweens.find((t) => t.target === "#dot")?.composedWith?.[0]?.summary).toContain("1.16");
});
it("uses one point for a set and two endpoints for a flat tween", () => {
  const r = surface('tl.set("#dot",{x:0},0);tl.to("#dot",{x:50,duration:1,ease:"elastic.out"},1);');
  expect(r.tweens[0]?.keyframes).toHaveLength(1);
  expect(r.tweens[1]?.keyframes).toHaveLength(2);
});
it("distinguishes amount, arithmetic, and dynamic staggers", () => {
  const dom = '<div class="dot"></div>'.repeat(3);
  expect(
    surface('tl.to(".dot",{opacity:0,duration:.2,stagger:{amount:.6}},1);', dom).tweens[0]?.end,
  ).toBe(1.8);
  expect(
    surface('tl.to(".dot",{opacity:0,duration:.2,stagger:2/100},1);', dom).tweens[0]?.end,
  ).toBe(1.24);
  expect(
    surface('tl.to(".dot",{opacity:0,duration:.2,stagger:i=>i*.1},1);', dom).tweens[0]?.end,
  ).toBeNull();
});
it("does not invent a finite end for infinite repeats", () => {
  expect(surface('tl.to("#dot",{x:50,duration:1,repeat:-1},0);').tweens[0]?.end).toBeNull();
});
it("preserves explicit intermediate keyframes", () => {
  const r = surface(
    'tl.to("#dot",{duration:1,keyframes:{"0%":{scale:0},"40%":{scale:1.18},"70%":{scale:.95},"100%":{scale:1}}},1);',
  );
  expect(r.tweens[0]?.keyframes.map((k) => k.time)).toEqual([1, 1.4, 1.7, 2]);
});
it("does not classify animated object proxies as a hold", () => {
  expect(surface("const cam={x:0};tl.to(cam,{x:50,duration:1},0);").tweens[0]?.target).not.toBe(
    "dwell/hold",
  );
});
it("marks cursor-dependent timing unknown after a stagger span changes", () => {
  const r = surface(
    'tl.to(".dot",{x:1,duration:1,stagger:.1},0);tl.to(".dot",{opacity:0,duration:1});',
    '<div class="dot"></div>'.repeat(3),
  );
  expect(r.tweens[1]?.start).toBeNull();
});
it("drops cursor-relative times after an unresolved delay", () => {
  const script = (follow: string) =>
    `tl.to("#dot",{x:1,duration:1,delay:getDelay()},0);tl.to("#dot",{x:2,duration:1}${follow});`;
  const implicit = surface(script(""));
  const relative = surface(script(',">"'));
  const absolute = surface(script(",4"));
  for (const tween of [implicit.tweens[1], relative.tweens[1]]) {
    expect(tween?.start).toBeNull();
    expect(tween?.end).toBeNull();
    expect(tween?.keyframes.map((point) => point.time)).toEqual([null, null]);
    expect(tween?.unresolved).toContain("start");
  }
  expect(absolute.tweens[1]?.start).toBe(4);
  expect(absolute.tweens[1]?.keyframes.map((point) => point.time)).toEqual([4, 5]);
});
it("reports the GSAP default duration and explicit delay", () => {
  expect(surface('tl.to("#dot",{x:50},0);').tweens[0]?.duration).toBe(0.5);
  expect(surface('tl.to("#dot",{x:50,duration:1,delay:.2},1);').tweens[0]?.start).toBe(1.2);
});
it("does not fabricate stops for dynamic keyframes", () => {
  const t = surface('tl.to("#dot",{duration:1,keyframes:makeFrames()},0);').tweens[0];
  expect(t?.keyframes).toHaveLength(0);
  expect(t?.unresolved).toContain("keyframes");
});

it("does not resolve a shadowed selector variable to an outer string constant", () => {
  const r = surface('const b="#dot";{let b=chooseTarget();tl.to(b,{x:10,duration:1},0);}');
  expect(r.tweens[0]?.target).toBe("__unresolved__");
});
