import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const script = new URL("./captions.mjs", import.meta.url).pathname;

test("does not insert spaces between Chinese caption tokens", () => {
  const dir = mkdtempSync(join(tmpdir(), "faceless-captions-cjk-"));
  try {
    writeFileSync(
      join(dir, "STORYBOARD.md"),
      "---\nformat: portrait\nlanguage: zh\n---\n\n## Frame 1 — Test\n\n- duration: 2\n",
    );
    writeFileSync(
      join(dir, "audio_meta.json"),
      JSON.stringify({
        voices: [
          {
            frame: 1,
            words: [
              { text: "你好", start: 0, end: 0.5 },
              { text: "世界", start: 0.5, end: 1 },
            ],
          },
        ],
      }),
    );

    const out = join(dir, "caption_groups.json");
    const result = spawnSync(
      process.execPath,
      [
        script,
        "build",
        "--storyboard",
        join(dir, "STORYBOARD.md"),
        "--audio-meta",
        join(dir, "audio_meta.json"),
        "--hyperframes",
        dir,
        "--out",
        out,
      ],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr);
    const groups = JSON.parse(readFileSync(out, "utf8")).groups;
    assert.equal(groups[0].text, "你好世界");
    assert.doesNotMatch(
      readFileSync(join(dir, "compositions/captions.html"), "utf8"),
      /w\.text \+ " "/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
