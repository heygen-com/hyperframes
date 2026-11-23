import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { Inspector } from "../src/service";

declare const Bun: { gc(force: boolean): void };

const project = mkdtempSync(join(tmpdir(), "hf-inspector-release-"));
const html = `<!doctype html><html><body><div data-composition-id="root" data-duration="1" data-width="1920" data-height="1080"><h1 id="title">Test</h1></div><script>const settings={x:1};window.__timelines={};</script></body></html>`;
writeFileSync(join(project, "index.html"), html);
const inspector = new Inspector(project, { idleMs: 100 });
const sources = () =>
  (
    inspector as unknown as { session: { sourceContext: () => { sources: object } } }
  ).session.sourceContext().sources;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  await inspector.inspect({ targets: [{ selector: "#title" }] });
  const previous = new WeakRef(sources());
  writeFileSync(join(project, "index.html"), html + "\n<!-- changed -->");
  await inspector.inspect({ targets: [{ selector: "#title" }] });
  const current = new WeakRef(sources());
  await inspector.withPage(async () => {
    await delay(200);
  });
  assert.equal(sources(), current.deref(), "Active query must cancel the previous idle timer");
  await delay(300);
  await inspector.dispose();
  await assert.rejects(() => inspector.elementMap(), /inspector_disposed/);
  await assert.rejects(() => inspector.withPage(async () => {}), /inspector_disposed/);
  for (let i = 0; i < 3; i++) {
    await delay(30);
    Bun.gc(true);
  }
  assert.equal(previous.deref(), undefined, "Previous source generation was retained");
  assert.equal(current.deref(), undefined, "Disposed source generation was retained");
  console.log(JSON.stringify({ previousReleased: true, currentReleased: true }));
} finally {
  await inspector.dispose();
  rmSync(project, { recursive: true, force: true });
}
