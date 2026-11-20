import { strict as assert } from "node:assert";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { heygenSfxProvider, sfxProvider } from "./sfx-provider.mjs";

const HOSTILE = "\x1b]52;c;aGk=\x07\x1b[2J";
const SHOWN = "\\x1b]52;c;aGk=\\x07\\x1b[2J";

function captureStderr(t) {
  const lines = [];
  t.mock.method(console, "error", (...args) => lines.push(args.join(" ")));
  return lines;
}

function assertEscaped(lines) {
  const out = lines.join("\n");
  assert.ok(out.includes(SHOWN), out);
  for (const raw of ["\x1b", "\x07"]) assert.ok(!out.includes(raw), JSON.stringify(out));
}

test(
  "an empty HeyGen sound search repeats the intent with control characters as visible escapes",
  {
    skip: process.platform === "win32" && "the fake heygen binary is a shell script",
  },
  async (t) => {
    const bin = mkdtempSync(join(tmpdir(), "sfx-provider-heygen-"));
    const savedPath = process.env.PATH;
    try {
      writeFileSync(join(bin, "heygen"), `#!/bin/sh\necho '{"data":[]}'\n`);
      chmodSync(join(bin, "heygen"), 0o755);
      process.env.PATH = `${bin}${delimiter}${savedPath}`;
      const lines = captureStderr(t);
      assert.equal(await heygenSfxProvider.search(`whoosh${HOSTILE}`), null);
      assertEscaped(lines);
    } finally {
      process.env.PATH = savedPath;
      rmSync(bin, { recursive: true, force: true });
    }
  },
);

test("an unreachable Openverse error prints with control characters as visible escapes", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error(`proxy said ${HOSTILE}`);
  });
  const lines = captureStderr(t);
  assert.equal(await sfxProvider.search("whoosh"), null);
  assertEscaped(lines);
});
