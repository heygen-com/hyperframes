import { Inspector } from "../src/service";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const page = (marker: string) =>
  `<!doctype html><html><body><div data-composition-id="root" data-start="0" data-duration="1" data-width="1920" data-height="1080"><p id="marker">${marker}</p></div><script>
  window.__registered = navigator.serviceWorker.register("/sw.js").then(() => navigator.serviceWorker.ready);
  window.__renderReady = true;
  </script></body></html>`;

const project = mkdtempSync(join(tmpdir(), "hf-inspect-sw-"));
writeFileSync(
  join(project, "sw.js"),
  `self.addEventListener("install", () => self.skipWaiting());
  self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
  self.addEventListener("fetch", (event) => {
    if (event.request.mode !== "navigate") return;
    event.respondWith(new Response(${JSON.stringify(page("STALE"))}, { headers: { "Content-Type": "text/html" } }));
  });`,
);
writeFileSync(join(project, "index.html"), page("OLD"));
const inspector = new Inspector(project, { instrument: false });
const marker = () =>
  inspector.withPage(async (p) => {
    await p.evaluate(() => (window as Window & { __registered?: Promise<unknown> }).__registered);
    return p.evaluate(() => document.getElementById("marker")?.textContent ?? "");
  });
try {
  assert.equal(await marker(), "OLD");
  writeFileSync(join(project, "index.html"), page("NEW"));
  assert.equal(await marker(), "NEW");
  assert.equal(inspector.stats.pageLoads, 2);
  console.log(JSON.stringify({ editedSourceIsInspected: true, stats: inspector.stats }));
} finally {
  await inspector.dispose();
  rmSync(project, { recursive: true, force: true });
}
