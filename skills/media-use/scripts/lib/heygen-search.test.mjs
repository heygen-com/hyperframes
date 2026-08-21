import { strict as assert } from "node:assert";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { HEYGEN_CLIENT_SOURCE_HEADERS } from "../../audio/scripts/lib/heygen.mjs";
import { HEYGEN_CLIENT_SOURCE_ARGV } from "./heygen-cli.mjs";
import { heygenSearch } from "./heygen-search.mjs";

test("tags HeyGen searches with the shared media-use client source", () => {
  const dir = mkdtempSync(join(tmpdir(), "media-use-heygen-search-"));
  const capturePath = join(dir, "argv.log");
  const heygenPath = join(dir, "heygen");
  const previousPath = process.env.PATH;
  const previousCapturePath = process.env.HEYGEN_CAPTURE_PATH;

  writeFileSync(
    heygenPath,
    `#!/bin/sh
printf '%s\\n' "$*" >> "$HEYGEN_CAPTURE_PATH"
printf '%s\\n' '{"data":[{"id":"x"}]}'
`,
  );
  chmodSync(heygenPath, 0o755);
  process.env.PATH = `${dir}:${previousPath ?? ""}`;
  process.env.HEYGEN_CAPTURE_PATH = capturePath;

  try {
    const result = heygenSearch("audio sounds list", "ocean", { limit: 1 });
    const argv = readFileSync(capturePath, "utf8").trim();

    assert.deepEqual(result, [{ id: "x" }]);
    assert.match(argv, /X-HeyGen-Client-Source: media-use/);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousCapturePath === undefined) delete process.env.HEYGEN_CAPTURE_PATH;
    else process.env.HEYGEN_CAPTURE_PATH = previousCapturePath;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("keeps CLI and REST media-use client source headers in lockstep", () => {
  const [entry] = Object.entries(HEYGEN_CLIENT_SOURCE_HEADERS);
  assert.ok(entry);
  const [key, value] = entry;

  assert.equal(HEYGEN_CLIENT_SOURCE_ARGV[1], `${key}: ${value}`);
});
