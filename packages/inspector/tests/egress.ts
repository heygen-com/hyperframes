import { Inspector } from "../src/service";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

let internalHits = 0;
const internal = createServer((_req, res) => {
  internalHits++;
  res.end("internal");
});
await new Promise<void>((done) => internal.listen(0, "127.0.0.1", done));
const { port } = internal.address() as AddressInfo;
const project = mkdtempSync(join(tmpdir(), "hf-inspect-egress-"));
writeFileSync(join(project, "asset.txt"), "own asset");
writeFileSync(
  join(project, "index.html"),
  `<!doctype html><html><body><div data-composition-id="root" data-start="0" data-duration="1" data-width="1920" data-height="1080"></div><script>
  const read = (url) => fetch(url).then((r) => r.text(), () => "refused");
  window.__probe = Promise.all([read("asset.txt"), read("http://127.0.0.1:${port}/"), read("http://localhost:${port}/")]);
  window.__renderReady = true;
  </script></body></html>`,
);
const inspector = new Inspector(project, { instrument: false });
try {
  const [own, loopback, localhost] = await inspector.withPage((page) =>
    page.evaluate(() => (window as Window & { __probe?: Promise<string[]> }).__probe ?? []),
  );
  assert.equal(own, "own asset");
  assert.equal(loopback, "refused");
  assert.equal(localhost, "refused");
  assert.equal(internalHits, 0);
  console.log(JSON.stringify({ ownAssetLoads: true, otherLoopbackServiceRefused: true }));
} finally {
  await inspector.dispose();
  internal.close();
  rmSync(project, { recursive: true, force: true });
}
