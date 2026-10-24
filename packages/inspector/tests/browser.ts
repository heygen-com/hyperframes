import { snippetSource } from "./snippetSource";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { Inspector } from "../src/service";
const vendor = process.argv[2];
if (!vendor) throw new Error("Pass an installed gsap.min.js path");
const project = mkdtempSync(join(tmpdir(), "hf-inspection-test-"));
mkdirSync(join(project, "assets"));
copyFileSync(vendor, join(project, "assets/gsap.min.js"));
const html = `<!doctype html><html><head><script src="assets/gsap.min.js"></script><style>
.box { width:40px; height:40px; background:red; position:absolute; }
</style></head><body><div id="root" data-composition-id="test" data-start="0" data-duration="100" data-width="1920" data-height="1080">
<div id="scene-a"><div id="title" class="box" data-hf-id="hf-one"></div></div>
<div id="scene-b"><div class="box" data-hf-id="hf-two" style="top:60px"></div></div></div><script>
const title = document.querySelector("#title");
const other = document.querySelector("[data-hf-id='hf-two']");
const tl = gsap.timeline({paused:true});
function move(element) {
  tl.to(element, {x:100, duration:2}, 1);
}
move(title);
move(other);
const child = gsap.timeline();
child.to(title, {y:20, duration:1}, 0);
tl.add(child, 4);
window.__timelines = window.__timelines || {};
window.__timelines.test = tl;
</script></body></html>`;
writeFileSync(join(project, "index.html"), html);
const inspector = new Inspector(project);
const control = new Inspector(project, { instrument: false });
const checks: string[] = [];
try {
  const cold = await inspector.inspect({ targets: [{ selector: "#title" }, { hfId: "hf-two" }] });
  assert(cold.results.every((r) => r.status === "found"));
  assert(cold.results.every((r) => r.unmappedAnimations === 0));
  checks.push("indirect GSAP source + nested timeline mapping");
  assert(
    cold.snippets.some((s) => s.code.includes("function move") || s.code.includes("tl.to(element")),
  );
  assert(cold.snippets.some((s) => s.targets?.length === 2 && s.code.includes("tl.to(element")));
  checks.push("multi-target source deduplication");
  for (const snippet of cold.snippets)
    assert.equal(snippet.code, snippetSource(project, snippet.id));
  checks.push("literal snippets equal original bytes");
  const single = await inspector.inspect({ targets: [{ selector: "#title" }] });
  const ambiguity = await inspector.inspect({
    targets: [
      { selector: ".box" },
      { selector: ".missing" },
      { selector: ".box", within: "#scene-b" },
    ],
  });
  assert.deepEqual(
    ambiguity.results.map((r) => r.status),
    ["found", "missing", "found"],
  );
  assert.equal(ambiguity.results[0].candidates.length, 2);
  assert(
    ambiguity.snippets.some((s) => s.targets?.includes(0) && s.code.includes("tl.to(element")),
  );
  const overlapping = await inspector.inspect({ targets: [{ selector: "#scene-a, #title" }] });
  assert.equal(overlapping.results[0].animations, single.results[0].animations);
  checks.push("class groups, overlapping scopes, partial success and optional within");
  const ref = cold.results[0].candidates[0].ref;
  const same = await inspector.inspect({ targets: [{ ref }] });
  assert.equal(same.results[0].status, "found");
  assert.equal(inspector.stats.pageLoads, 1);
  assert.equal(inspector.stats.seeks, 0);
  checks.push("child ref round trip + reuse + no default seek");
  const small = await inspector.inspect({ targets: [{ selector: "#root" }], maxBytes: 2048 });
  assert(Buffer.byteLength(JSON.stringify(small)) <= 2048);
  assert(small.omittedCount > 0);
  const more = await inspector.inspect({
    targets: [],
    generation: small.generation,
    snippets: small.omitted.map((s) => s.id),
    maxBytes: 12000,
  });
  assert(more.snippets.length > 0);
  checks.push("bounded complete blocks + continuation");
  const before = await inspector.withPage(async (page) => {
    await page.evaluate(() => {
      const w = window as Window & {
        __player?: { renderSeek: (t: number, o: { exact: boolean }) => void };
      };
      w.__player!.renderSeek(1.56, { exact: true });
    });
    return Buffer.from(await page.screenshot());
  });
  const off = await control.withPage(async (page) => {
    await page.evaluate(() => {
      const w = window as Window & {
        __player?: { renderSeek: (t: number, o: { exact: boolean }) => void };
      };
      w.__player!.renderSeek(1.56, { exact: true });
    });
    return Buffer.from(await page.screenshot());
  });
  assert(before.equals(off));
  checks.push("instrumented/off pixel parity at 1.56s");
  writeFileSync(join(project, "index.html"), html.replace("x:100", "x:150"));
  const changed = await inspector.inspect({
    targets: [{ ref }, { selector: "#title" }],
    time: 61.56,
  });
  assert.equal(changed.results[0].status, "stale-ref");
  assert.equal(changed.results[1].status, "found");
  assert(changed.snippets.some((s) => s.code.includes("x:150")));
  assert.equal(inspector.stats.pageLoads, 2);
  assert.equal(inspector.stats.browserStarts, 1);
  checks.push("edit replaces page, reuses browser, invalidates refs");
  await assert.rejects(
    () =>
      inspector.inspect({
        targets: [],
        generation: small.generation,
        snippets: [small.omitted[0].id],
      }),
    /stale_generation/,
  );
  checks.push("stale snippet continuation rejected");
  const concurrent = await Promise.all([
    inspector.inspect({ targets: [{ selector: "#title" }] }),
    inspector.inspect({ targets: [{ hfId: "hf-two" }] }),
  ]);
  assert.equal(concurrent[0].generation, concurrent[1].generation);
  checks.push("concurrent queries share generation");
  console.log(
    JSON.stringify(
      {
        checks,
        coldMs: cold.elapsedMs,
        warmMs: single.elapsedMs,
        afterEditMs: changed.elapsedMs,
        bytes: Buffer.byteLength(JSON.stringify(cold)),
        stats: inspector.stats,
      },
      null,
      2,
    ),
  );
} finally {
  await inspector.dispose();
  await control.dispose();
  rmSync(project, { recursive: true, force: true });
}
