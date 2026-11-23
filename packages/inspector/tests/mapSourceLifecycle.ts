import { Inspector } from "../src/service";
import { mkdtempSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
const project = mkdtempSync(join(tmpdir(), "hf-map-source-"));
copyFileSync(process.argv[2], join(project, "gsap.min.js"));
const document = (x: number) =>
  `<!doctype html><html><head><style>#target {color: red}</style><script src="gsap.min.js"></script></head><body><div data-composition-id="root" data-start="0" data-duration="10" data-width="1920" data-height="1080"><div id="target">Hello</div></div><script>const tl=gsap.timeline({paused:true}); tl.to("#target",{x:${x},duration:1},1); window.__timelines={root:tl};</script></body></html>`;
writeFileSync(join(project, "index.html"), document(50));
const inspector = new Inspector(project);
try {
  const first = await inspector.elementMap();
  await inspector.elementMap();
  assert.equal(inspector.stats.sourceLoads, 0);
  const component = await inspector.inspect({ targets: [{ selector: "#target" }] });
  assert.equal(component.generation, first.generation);
  assert.equal(inspector.stats.pageLoads, 1);
  assert.equal(inspector.stats.sourceLoads, 1);
  assert(component.snippets.some((s) => s.code.includes("x:50")));
  await inspector.timeline({ range: [0, 3] });
  assert.equal(inspector.stats.sourceLoads, 1);
  writeFileSync(join(project, "index.html"), document(80));
  const updated = await inspector.elementMap();
  assert.notEqual(updated.generation, first.generation);
  assert.equal(inspector.stats.sourceLoads, 1);
  await inspector.timeline({ range: [0, 3] });
  assert.equal(inspector.stats.sourceLoads, 2);
  const next = await inspector.inspect({ targets: [{ selector: "#target" }] });
  assert(next.snippets.some((s) => s.code.includes("x:80")));
  assert.equal(inspector.stats.sourceLoads, 2);
  console.log(
    JSON.stringify({
      mapSkipsSources: true,
      queryReusesPage: true,
      indexReused: true,
      sourceChangeInvalidates: true,
      stats: inspector.stats,
    }),
  );
} finally {
  await inspector.dispose();
  rmSync(project, { recursive: true, force: true });
}
