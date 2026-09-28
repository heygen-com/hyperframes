import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The stub stands in for `npx hyperframes transcribe <in> --dir <dir> ...`: it records its args,
// writes the CLI's flat array and prints the CLI's --json line naming `cliEngine`.
function runScript(engine, cliEngine) {
  const root = mkdtempSync(join(tmpdir(), "media-use-transcribe-"));
  try {
    const bin = join(root, "bin");
    mkdirSync(bin);
    writeFileSync(
      join(bin, "npx"),
      `#!/bin/sh\necho "$@" > "${root}/args"\nwhile [ "$1" != "--dir" ]; do shift; done\n` +
        `echo '[{"text":"a","start":0,"end":1},{"text":"b","start":1,"end":2}]' > "$2/transcript.json"\n` +
        `echo '{"ok":true,"engine":"${cliEngine}"}'\n`,
    );
    chmodSync(join(bin, "npx"), 0o755);
    const input = join(root, "in.wav");
    writeFileSync(input, "");
    const script = fileURLToPath(new URL("./transcribe.mjs", import.meta.url));
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: root };
    delete env.HYPERFRAMES_PARAKEET;
    const out = execFileSync(
      process.execPath,
      [script, "--input", input, "--engine", engine, "--json"],
      {
        encoding: "utf8",
        env: { ...env, HYPERFRAMES_MEDIA_HOME: join(root, "home"), HYPERFRAMES_NO_TELEMETRY: "1" },
      },
    );
    return { result: JSON.parse(out.trim()), args: readFileSync(join(root, "args"), "utf8") };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test(
  "--engine whisper makes the CLI run whisper and reports the flat transcript's word count",
  { skip: process.platform === "win32" },
  () => {
    const { result, args } = runScript("whisper", "whisper");
    assert.match(args, /--engine whisper --json/);
    assert.equal(result.words, 2);
    assert.equal(result.engine, "whisper");
  },
);

test(
  "auto reports the engine the CLI says it ran, Parakeet included",
  { skip: process.platform === "win32" },
  () => {
    const { result, args } = runScript("auto", "parakeet");
    assert.match(args, /--engine auto --json/);
    assert.equal(result.engine, "parakeet");
  },
);

test(
  "--engine parakeet without parakeet-mlx asks the CLI for its Parakeet",
  { skip: process.platform === "win32" },
  () => {
    const { result, args } = runScript("parakeet", "parakeet");
    assert.match(args, /--engine parakeet --json/);
    assert.equal(result.engine, "parakeet");
  },
);

test(
  "a failed --engine parakeet run reports the reason the CLI printed on stdout",
  { skip: process.platform === "win32" },
  () => {
    const root = mkdtempSync(join(tmpdir(), "media-use-transcribe-"));
    try {
      const bin = join(root, "bin");
      mkdirSync(bin);
      const reason =
        "Parakeet is not installed. Install it with: hyperframes models install parakeet";
      writeFileSync(
        join(bin, "npx"),
        `#!/bin/sh\necho '{"ok":false,"error":"${reason}"}'\nexit 1\n`,
      );
      chmodSync(join(bin, "npx"), 0o755);
      const input = join(root, "in.wav");
      writeFileSync(input, "");
      const script = fileURLToPath(new URL("./transcribe.mjs", import.meta.url));
      const res = spawnSync(
        process.execPath,
        [script, "--input", input, "--engine", "parakeet", "--json"],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            HYPERFRAMES_PARAKEET: "",
            PATH: `${bin}:${process.env.PATH}`,
            HOME: root,
            HYPERFRAMES_MEDIA_HOME: join(root, "home"),
            HYPERFRAMES_NO_TELEMETRY: "1",
          },
        },
      );
      assert.equal(res.status, 1);
      assert.match(JSON.parse(res.stdout.trim()).error, /hyperframes models install parakeet/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
