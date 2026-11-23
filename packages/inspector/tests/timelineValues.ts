import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Inspector } from "../src/service";
import { animationValues } from "../../core/src/runtime/timelineValues";
const unknown = { kind: "unknown", value: null };
assert.deepEqual(animationValues({ scale: () => 1 }, ["scale"]).properties[0].to, unknown);
assert.equal(animationValues({ x: "+=10" }, ["x"]).properties[0].to.kind, "relative");
assert.equal(animationValues({ x: "random(0,10)" }, ["x"]).properties[0].to.kind, "expression");
assert.deepEqual(animationValues({ x: NaN }, ["x"]).properties[0].to, unknown);
const project = mkdtempSync(join(tmpdir(), "hf-timeline-values-"));
copyFileSync(process.argv[2], join(project, "gsap.js"));
writeFileSync(
  join(project, "index.html"),
  `<html><head><script src="gsap.js"></script></head><body><div data-composition-id="main" data-duration="10" data-width="1920" data-height="1080"><div id="bubble"></div><div id="from"></div><div id="rel"></div><div class="member"></div><div class="member"></div><svg><rect id="attr"></rect></svg><div id="fn"></div><div id="kf"></div><div id="round"></div></div><script>
const tl=gsap.timeline({paused:true});
tl.fromTo('#bubble',{scale:0},{scale:1.18,duration:.16,ease:'power2.out'},1.8);
tl.to('#bubble',{scale:.95,duration:.11,ease:'sine.inOut'},1.96);
tl.to('#bubble',{scale:1.04,duration:.09,ease:'sine.inOut'},2.07);
tl.to('#bubble',{scale:1,duration:.09,ease:'sine.out'},2.16);
tl.from('#from',{x:100,duration:1},3);
tl.to('#rel',{x:'+=10',duration:1},3);
tl.to('.member',{x:i=>100+i,duration:1,stagger:.2},4);
tl.fromTo('#attr',{attr:{width:0}},{attr:{width:50},duration:1},6);
tl.to('#fn',{x:10,duration:1,ease:t=>t*t},6);
tl.to('#kf',{keyframes:{x:[0,10,20]},ease:'steps(8)',duration:1},7);
tl.to('#round',{rotation:2.6999999999999997,duration:1},8);
window.__timelines={main:tl};
</script></body></html>`,
);
const inspector = new Inspector(project);
try {
  const result = await inspector.timeline({
    component: { selector: "#bubble" },
    range: [1.8, 2.3],
  });
  assert.equal(result.events.length, 4);
  assert.deepEqual(
    result.events.map((e) => e.values?.properties[0].to.value),
    [1.18, 0.95, 1.04, 1],
  );
  assert.equal(result.events[0].values?.properties[0].from.value, 0);
  assert.deepEqual(result.events[1].values?.properties[0].from, unknown);
  assert.equal(result.events[1].values?.ease.value, "sine.inOut");
  assert(result.text.includes("scale: ? → 0.95"));
  const from = await inspector.timeline({ component: { selector: "#from" } });
  assert.equal(from.events[0].values?.properties[0].from.value, 100);
  assert.deepEqual(from.events[0].values?.properties[0].to, unknown);
  const rel = await inspector.timeline({ component: { selector: "#rel" } });
  assert.equal(rel.events[0].values?.properties[0].to.kind, "relative");
  const members = await inspector.timeline({ range: [4, 6] });
  const animations = members.events.filter((e) => e.kind === "animation");
  assert.equal(animations.length, 2);
  assert(animations.every((e) => e.values?.properties[0].to.kind === "unknown"));
  const textOf = async (selector: string) =>
    (await inspector.timeline({ component: { selector } })).text;
  assert.match(await textOf("#attr"), /attr\.width: 0 → 50/);
  assert.match(await textOf("#fn"), /ease: custom function/);
  assert.match(await textOf("#kf"), /ease: steps\(8\) across keyframes/);
  assert.match(await textOf("#round"), /rotation: \? → 2\.7;/);
  console.log(result.text);
  console.log(
    "PASS authored endpoints, unknown starts, from direction, ease, relative values, function values, stagger, attr values, custom and keyframe eases and rounding",
  );
} finally {
  await inspector.dispose();
  rmSync(project, { recursive: true, force: true });
}
