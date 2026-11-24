import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SKILL = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// fails without the fix: run.sh ran packages/cli/dist/cli.js from two folders above the skill, which in a
// project-scope install (<project>/.agents/skills/<skill>) is the project's own folder.
test(
  "the corpus runner never runs a CLI planted above a project-scope install",
  { skip: process.platform === "win32" },
  (t) => {
    const project = mkdtempSync(join(tmpdir(), "hf-corpus-project-"));
    t.after(() => rmSync(project, { recursive: true, force: true }));
    const skill = join(project, ".agents/skills/remotion-to-hyperframes");
    cpSync(join(SKILL, "scripts/lint_source.py"), join(skill, "scripts/lint_source.py"));
    cpSync(join(SKILL, "assets/test-corpus/run.sh"), join(skill, "assets/test-corpus/run.sh"));
    const fixture = join(skill, "assets/test-corpus/tier-1-title-card");
    cpSync(join(SKILL, "assets/test-corpus/tier-1-title-card"), fixture, { recursive: true });
    mkdirSync(join(fixture, "remotion-src/node_modules"), { recursive: true });

    const ran = join(project, "ran");
    const mark = (who) => `require("node:fs").appendFileSync(${JSON.stringify(ran)}, "${who}\\n");`;
    mkdirSync(join(project, ".agents/packages/cli/dist"), { recursive: true });
    mkdirSync(join(project, "packages/cli/dist"), { recursive: true });
    writeFileSync(join(project, ".agents/packages/cli/dist/cli.js"), mark("planted"));
    writeFileSync(join(project, "packages/cli/dist/cli.js"), mark("planted"));
    const handed = join(project, "handed.cjs");
    writeFileSync(handed, mark("handed"));
    const bin = join(project, "bin");
    mkdirSync(bin);
    for (const tool of ["ffmpeg", "npm", "npx"])
      writeFileSync(join(bin, tool), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

    const run = (env) =>
      spawnSync("bash", [join(skill, "assets/test-corpus/run.sh"), "tier-1-title-card"], {
        cwd: project,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${bin}${delimiter}${process.env.PATH}`,
          HYPERFRAMES_CLI_ENTRY: "",
          ...env,
        },
      });
    const refused = run({});
    assert.equal(existsSync(ran), false);
    assert.match(refused.stdout, /render toolchain unavailable/);
    assert.match(refused.stderr, /HYPERFRAMES_CLI_ENTRY/);
    run({ HYPERFRAMES_CLI_ENTRY: handed });
    assert.equal(readFileSync(ran, "utf8"), "handed\nhanded\n");
  },
);
