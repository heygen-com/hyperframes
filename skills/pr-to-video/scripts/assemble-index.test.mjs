import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const assembleScript = new URL("./assemble-index.mjs", import.meta.url).pathname;

// ── bgm_pending at the assembly boundary ─────────────────────────────────────
// Regression: the flag survived into audio_meta.json but assemble rebuilt its audio object
// from three named keys and dropped it, so the step that actually builds the film could not
// tell "not ready yet" from "silent by design" and would ship the silent one.

function assembleWith({ audioMeta, extraArgs = [] }) {
  const dir = mkdtempSync(join(tmpdir(), "product-launch-assemble-"));
  writeFileSync(
    join(dir, "STORYBOARD.md"),
    "---\nformat: 1920x1080\nmessage: T\n---\n\n## Frame 1 — A\n- duration: 3s\n- src: compositions/frames/01-a.html\n",
  );
  mkdirSync(join(dir, "compositions", "frames"), { recursive: true });
  writeFileSync(
    join(dir, "compositions", "frames", "01-a.html"),
    // pr-to-video's frame contract wants one bare <template> whose inner root carries the
    // composition id and duration (lib/frame-contract.mjs).
    '<template><div data-composition-id="01-a" data-width="1920" data-height="1080" ' +
      'data-duration="3"><section class="clip" data-start="0" data-duration="3"></section>' +
      "</div></template>",
  );
  if (audioMeta) writeFileSync(join(dir, "audio_meta.json"), JSON.stringify(audioMeta));
  const r = spawnSync(
    process.execPath,
    [
      assembleScript,
      "--storyboard",
      join(dir, "STORYBOARD.md"),
      "--hyperframes",
      dir,
      ...extraArgs,
    ],
    { encoding: "utf8" },
  );
  return { dir, r };
}

test("assemble REFUSES while bgm_pending and no bed on disk", () => {
  const { dir, r } = assembleWith({
    audioMeta: { bgm: null, bgm_pending: true, voices: [], sfx: [] },
  });

  assert.notEqual(r.status, 0, "should not assemble a silent film over a pending bed");
  assert.match(r.stderr, /bgm_pending/);
  // Refusing means producing nothing, not a half-built index.
  assert.equal(existsSync(join(dir, "index.html")), false);
});

test("--allow-pending-bgm assembles anyway, and says so", () => {
  const { dir, r } = assembleWith({
    audioMeta: { bgm: null, bgm_pending: true, voices: [], sfx: [] },
    extraArgs: ["--allow-pending-bgm"],
  });

  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(join(dir, "index.html")), true);
  assert.match(r.stdout + r.stderr, /pending/i);
});

test("a film that is silent BY DESIGN still assembles untouched", () => {
  // The whole point of carrying the flag: this case must stay distinguishable from the above.
  const { dir, r } = assembleWith({ audioMeta: { bgm: null, voices: [], sfx: [] } });

  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(join(dir, "index.html")), true);
  assert.doesNotMatch(r.stderr, /bgm_pending/);
});
