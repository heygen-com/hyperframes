import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./make-theme.cjs", import.meta.url));
const SKILL = dirname(dirname(SCRIPT));

function compilePostFx(grain) {
  const root = mkdtempSync(join(tmpdir(), "embedded-captions-theme-"));
  const skill = join(root, "skill");
  const project = join(root, "project");

  mkdirSync(join(skill, "scripts"), { recursive: true });
  mkdirSync(join(skill, "themes"), { recursive: true });
  mkdirSync(project);
  cpSync(SCRIPT, join(skill, "scripts", "make-theme.cjs"), { recursive: true });
  const dna = JSON.parse(readFileSync(join(SKILL, "themes", "anchor.json"), "utf8"));
  if (grain === undefined) delete dna.plate.grain;
  else dna.plate.grain = grain;
  writeFileSync(join(skill, "themes", "anchor.json"), JSON.stringify(dna));

  writeFileSync(
    join(project, "theme.json"),
    JSON.stringify({
      dna: "anchor",
      lines: [["HELLO"]],
      width: 480,
      height: 270,
      fps: 24,
      duration: 2,
    }),
  );
  writeFileSync(
    join(project, "transcript.json"),
    JSON.stringify({ words: [{ text: "HELLO", start: 0.3, end: 0.7 }] }),
  );

  try {
    execFileSync(process.execPath, [join(skill, "scripts", "make-theme.cjs"), project]);
    return readFileSync(join(project, "_postfx.sh"), "utf8");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("explicit plate grain zero omits the noise filter", () => {
  const postFx = compilePostFx(0);

  assert.doesNotMatch(postFx, /noise=alls=/);
  assert.match(postFx, /\[0:v\]null\[v\]/);
});

test("missing plate grain retains the default noise level", () => {
  const postFx = compilePostFx(undefined);

  assert.match(postFx, /noise=alls=5:allf=t\+u/);
});
