import { mkdtempSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { Inspector } from "../src/service";
const vendor = process.argv[2];
if (!vendor) throw new Error("Pass gsap.min.js");
const project = mkdtempSync(join(tmpdir(), "hf-timeline-test-"));
copyFileSync(vendor, join(project, "gsap.js"));
const html = `<html><head><script src="gsap.js"></script></head><body><div id="root" data-composition-id="main" data-start="0" data-duration="20" data-width="1920" data-height="1080"><div id="title" data-hf-id="title-hf">${'<span class="ch">A</span>'.repeat(12)}</div><div id="bars">${'<span class="bar"></span>'.repeat(8)}</div><div id="grain"></div><div id="nested"></div><div id="stretch"><span class="stretch"></span><span class="stretch"></span></div><div id="item" data-start="2" data-duration="3"></div></div><script>
const tl=gsap.timeline({paused:true});
for(let n=0;n<120;n++) tl.set("#grain",{x:n},n/120);
tl.to('.ch',{opacity:0,duration:.42,stagger:.025},7.33);
tl.set('.ch',{opacity:1,x:0},7.9);
const child=gsap.timeline({repeat:1,repeatDelay:1,yoyo:true});
child.to('#nested',{x:100,duration:.5},.5);
child.set({}, {},2);child.timeScale(2);tl.add(child,10);
tl.to('#bars .bar',{scaleY:1,duration:.3,stagger:.03},2.2);
tl.set('#bars .bar',{transformOrigin:'50% 0%'},2.5);
tl.to('#bars .bar',{scaleY:0,duration:.35,stagger:.03},2.5);
tl.to('.ch', {y:10,duration:1,stagger:2},30);
const stretched=gsap.to('.stretch',{x:10,duration:1,stagger:2});stretched.duration(6);tl.add(stretched,50);
window.__timelines={main:tl};
</script></body></html>`;
writeFileSync(join(project, "index.html"), html);
const i = new Inspector(project);
try {
  const repeated = await i.timeline({ range: [0, 1] });
  assert.equal(repeated.events.filter((e) => e.targets.some((t) => t.id === "grain")).length, 120);
  assert.equal(repeated.nextOffset, null);
  assert(repeated.text.includes("120 events"));
  assert.equal((repeated.text.match(/instant animation #grain/g) ?? []).length, 1);
  const exact = await i.timeline({ boundary: 0.5, component: { selector: "#grain" } });
  assert.equal(exact.events.length, 1);
  const group = await i.inspect({ targets: [{ selector: ".ch" }], descendants: false });
  assert.equal(group.results[0].status, "found");
  assert(group.results[0].animations > 0);
  assert.equal(group.snippets.filter((s) => s.code.includes("stagger:.025")).length, 1);
  const boundary = await i.timeline({ boundary: 7.9, component: { selector: "#title" } });
  assert(boundary.events.some((e) => e.relation === "crosses" && Math.abs(e.end - 8.025) < 1e-7));
  assert(boundary.events.some((e) => e.relation === "instant" && e.start === 7.9));
  assert(boundary.text.includes("#title"));
  assert(boundary.text.includes(".ch ×12"));
  assert(boundary.text.includes("share targets"));
  const bars = await i.timeline({ boundary: 2.5, component: { selector: "#bars" } });
  assert.equal(bars.events.filter((e) => e.relation === "crosses").length, 7);
  assert.equal(bars.events.filter((e) => e.relation === "starts").length, 1);
  const ending = bars.events.find((e) => e.relation === "ends")!;
  const starting = bars.events.find((e) => e.relation === "starts")!;
  assert.equal(ending.targets[0].ref, starting.targets[0].ref);
  assert(bars.text.includes("Later stagger members are excluded, not absent"));
  assert(bars.text.includes("touch at an endpoint only, no positive-duration overlap"));
  assert(bars.text.includes("2.2300–2.5300s crosses"));
  assert(bars.text.includes("2.4100–2.7100s crosses"));
  assert(bars.text.includes("context only; these do NOT start at the queried boundary"));
  assert(bars.text.includes("2.5300–2.8800s scaleY"));
  assert(bars.text.includes("2.7100–3.0600s scaleY"));
  assert.equal(
    (bars.text.match(/endpoint handoff: NO duration overlap on this target/g) ?? []).length,
    7,
  );
  const nested = await i.timeline({ component: { selector: "#nested" } });
  assert.deepEqual(
    nested.events.filter((e) => e.kind === "animation").map((e) => [e.start, e.end]),
    [
      [10.25, 10.5],
      [12, 12.25],
    ],
  );
  assert.equal(
    (await i.timeline({ component: { selector: "#nested" }, at: 11.25 })).events.length,
    0,
  );
  assert.equal(
    (await i.timeline({ component: { selector: "#nested" }, at: 10.5 })).events.length,
    0,
  );
  assert.equal(
    (await i.timeline({ component: { selector: "#nested" }, boundary: 10.5 })).events[0].relation,
    "ends",
  );
  assert.equal(
    (await i.timeline({ component: { selector: "#nested" }, boundary: 10.25 })).events[0].relation,
    "starts",
  );
  assert.equal((await i.timeline({ component: { selector: ".ch" } })).status, "ambiguous");
  assert.equal((await i.timeline({ component: { hfId: "title-hf" }, at: 7.9 })).status, "found");
  const ref = (await i.inspect({ targets: [{ selector: "#title" }] })).results[0].candidates[0].ref;
  assert.equal((await i.timeline({ component: { ref } })).status, "found");
  assert.equal(
    (await i.timeline({ range: [2, 3], component: { selector: "#item" } })).events[0].end,
    5,
  );
  await assert.rejects(i.timeline({ at: 1, boundary: 1 }));
  await assert.rejects(i.timeline({ range: [2, 1] }));
  assert.equal(
    (await i.timeline({ component: { selector: "#title" }, at: 31.5 })).events.length,
    0,
  );
  const stretched = await i.timeline({ component: { selector: "#stretch" } });
  assert.deepEqual(
    stretched.events.map((e) => [e.start, e.end]),
    [
      [50, 52],
      [54, 56],
    ],
  );
  assert.equal(
    (await i.timeline({ component: { selector: "#stretch" }, at: 53 })).events.length,
    0,
  );
  assert.equal(i.stats.browserStarts, 1);
  assert.equal(i.stats.pageLoads, 1);
  assert.equal(i.stats.seeks, 0);
  writeFileSync(join(project, "index.html"), html + "\n");
  assert.equal((await i.timeline({ component: { ref } })).status, "stale-ref");
  await assert.rejects(i.timeline({ generation: boundary.generation }));
  console.log(boundary.text);
  console.log(
    "PASS stagger/reset, nested repeat/yoyo/speed, repeat gap, boundary endpoints, IDs/ref, ambiguity, validation, static range, reuse/no-seek, stale lifecycle",
  );
} finally {
  await i.dispose();
  rmSync(project, { recursive: true, force: true });
}
