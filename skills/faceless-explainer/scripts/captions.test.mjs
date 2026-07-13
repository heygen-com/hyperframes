import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), "captions.mjs");

test("groups character-level Mandarin timings into readable captions", () => {
  const dir = mkdtempSync(join(tmpdir(), "hf-cjk-captions-"));
  writeFileSync(
    join(dir, "STORYBOARD.md"),
    `---
format: 1920x1080
---

## Frame 1 — CJK grouping
- duration: 2s
- scene: Chinese caption grouping repro
`,
  );
  const characters = [..."检索增强生成系统优化"];
  writeFileSync(
    join(dir, "audio_meta.json"),
    JSON.stringify({
      voices: [
        {
          frame: 1,
          words: characters.map((text, index) => ({
            text,
            start: index / 10,
            end: index / 10 + 0.09,
          })),
        },
      ],
    }),
  );

  try {
    execFileSync(
      process.execPath,
      [
        scriptPath,
        "build",
        "--storyboard",
        join(dir, "STORYBOARD.md"),
        "--audio-meta",
        join(dir, "audio_meta.json"),
        "--hyperframes",
        dir,
      ],
      { stdio: "pipe" },
    );
    const output = JSON.parse(readFileSync(join(dir, "caption_groups.json"), "utf8"));
    assert.deepEqual(
      output.groups.map((group) => group.text),
      ["检索增强", "生成系统", "优化"],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
