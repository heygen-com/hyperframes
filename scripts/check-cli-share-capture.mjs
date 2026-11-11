import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Exercise the bundled CLI, whose import.meta.url differs from the share source tree.
const dist = resolve(process.argv[2]);
const chunk = readdirSync(dist).find((name) => {
  if (!name.endsWith(".js")) return false;
  const source = readFileSync(join(dist, name), "utf8");
  return /export\s*\{[^}]*\bshareContentFingerprint\b/s.test(source);
});
assert.ok(chunk, "CLI must expose its bundled source fingerprint to the share command");
const { shareContentFingerprint } = await import(pathToFileURL(join(dist, chunk)).href);
const project = mkdtempSync(join(tmpdir(), "hyperframes-packed-share-"));
try {
  writeFileSync(join(project, "index.html"), "<html><body>Video</body></html>");
  const asset = join(project, "café.txt");
  writeFileSync(asset, "first");
  const before = await shareContentFingerprint(project);
  assert.match(before, /^[a-f0-9]{64}$/);
  writeFileSync(asset, "second");
  assert.notEqual(await shareContentFingerprint(project), before);
  console.log("Bundled CLI captures portable source with its policy and Unicode registries.");
} finally {
  rmSync(project, { recursive: true, force: true });
}
