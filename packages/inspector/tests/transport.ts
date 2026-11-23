import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import assert from "node:assert/strict";
const server = spawn(
  process.execPath,
  ["run", new URL("../src/server.ts", import.meta.url).pathname, process.argv[2]],
  { stdio: ["ignore", "pipe", "pipe"] },
);
const lines = createInterface({ input: server.stdout });
const [first] = await Promise.race([
  new Promise<string[]>((resolve) => lines.once("line", (line) => resolve([line]))),
  new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("service startup timeout")), 10000).unref(),
  ),
]);
const { url } = JSON.parse(first);
try {
  const info = await (await fetch(url + "/info")).json();
  assert.equal(info.stats.browserStarts, 0);
  const response = await fetch(url + "/inspect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ targets: [{ selector: "#flow-title" }] }),
  });
  const text = await response.text();
  const output = JSON.parse(text);
  assert.equal(output.results[0].status, "found");
  assert.equal(output.results[0].unmappedAnimations, 0);
  const next = await (await fetch(url + "/info")).json();
  assert.equal(next.stats.browserStarts, 1);
  assert.equal(next.stats.seeks, 0);
  console.log(
    JSON.stringify({
      http: true,
      lazyBrowser: true,
      bytes: Buffer.byteLength(text),
      stats: next.stats,
    }),
  );
} finally {
  server.kill("SIGTERM");
  await new Promise<void>((resolve) => server.once("exit", () => resolve()));
  lines.close();
}
