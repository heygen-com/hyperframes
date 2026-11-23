import { Inspector } from "../src/service";
import { mkdtempSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
const project = mkdtempSync(join(tmpdir(), "hf-inspect-lifecycle-"));
copyFileSync(process.argv[2], join(project, "gsap.min.js"));
writeFileSync(
  join(project, "index.html"),
  `<!doctype html><html><head><script src="gsap.min.js"></script></head><body><div data-composition-id="root" data-start="0" data-duration="10" data-width="1920" data-height="1080"><div id="target"></div></div><script>const tl=gsap.timeline({paused:true}); tl.to("#target",{x:50,duration:1},1); window.__timelines={root:tl};</script></body></html>`,
);
const inspector = new Inspector(project, { idleMs: 50 });
try {
  const first = await inspector.inspect({ targets: [{ selector: "#target" }] });
  const ref = first.results[0].candidates[0].ref;
  await new Promise((r) => setTimeout(r, 150));
  const next = await inspector.inspect({ targets: [{ ref }] });
  assert.equal(next.results[0].status, "stale-ref");
  assert.equal(inspector.stats.browserStarts, 2);
  await inspector.withPage(async (page) => {
    const restored = await page.evaluate(() => {
      const w = window as Window & {
        gsap?: { to: unknown };
        __hfInspection?: { dispose: () => void };
      };
      const wrapped = w.gsap?.to;
      w.__hfInspection?.dispose();
      return { different: w.gsap?.to !== wrapped, removed: !w.__hfInspection };
    });
    assert(restored.different && restored.removed);
  });
  await inspector.dispose();
  await assert.rejects(() => inspector.inspect({ targets: [{ selector: "#target" }] }), /disposed/);
  console.log(
    JSON.stringify({
      idleRelease: true,
      expiredRef: true,
      restoredHooks: true,
      disposedRejectsQueries: true,
      stats: inspector.stats,
    }),
  );
} finally {
  await inspector.dispose();
  rmSync(project, { recursive: true, force: true });
}
