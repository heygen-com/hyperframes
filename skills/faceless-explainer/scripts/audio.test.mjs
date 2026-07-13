import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILLS = resolve(HERE, "..", "..");
const ADAPTERS = ["faceless-explainer", "product-launch-video", "pr-to-video"];

test("fetch-sfx ignores the none sentinel across shared adapters", async (t) => {
  for (const skill of ADAPTERS) {
    await t.test(skill, () => {
      const project = mkdtempSync(join(tmpdir(), "hyperframes-sfx-none-"));
      try {
        writeFileSync(
          join(project, "STORYBOARD.md"),
          [
            "---",
            "format: portrait",
            "message: SFX sentinel regression",
            "---",
            "",
            "## Frame 1 — Silent beat",
            "- duration: 1s",
            "- sfx: none",
            "",
            "## Frame 2 — Audible beat",
            "- duration: 1s",
            "- sfx: whoosh, NONE",
            "",
          ].join("\n"),
        );
        const engine = join(project, "fake-engine.mjs");
        writeFileSync(
          engine,
          [
            'import { readFileSync, writeFileSync } from "node:fs";',
            "const arg = (name) => process.argv[process.argv.indexOf(name) + 1];",
            'const request = JSON.parse(readFileSync(arg("--request"), "utf8"));',
            "const sfx = (request.lines ?? []).flatMap((line) =>",
            "  (line.sfx ?? []).map((name) => ({ id: line.id, file: `assets/sfx/${name}.mp3` })),",
            ");",
            'writeFileSync(arg("--out"), JSON.stringify({ voices: [], bgm: null, sfx }));',
          ].join("\n"),
        );

        const adapter = join(SKILLS, skill, "scripts", "audio.mjs");
        const result = spawnSync(
          process.execPath,
          [
            adapter,
            "fetch-sfx",
            "--storyboard",
            join(project, "STORYBOARD.md"),
            "--hyperframes",
            project,
          ],
          {
            encoding: "utf8",
            env: { ...process.env, HF_MEDIA_ENGINE: engine },
          },
        );
        assert.equal(result.status, 0, result.stderr);

        const request = JSON.parse(readFileSync(join(project, "audio_request.json"), "utf8"));
        assert.deepEqual(request.lines, [{ id: "02", sfx: ["whoosh"] }]);
        const meta = JSON.parse(readFileSync(join(project, "audio_meta.json"), "utf8"));
        assert.deepEqual(meta.sfx, [
          {
            frame: 2,
            file: "assets/sfx/whoosh.mp3",
            offset_s: 0,
            duration_s: 1,
            volume: 0.35,
          },
        ]);
      } finally {
        rmSync(project, { recursive: true, force: true });
      }
    });
  }
});
