import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The stub stands in for the `hyperframes` CLI the caller hands over in HYPERFRAMES_CLI_ENTRY,
// run as `transcribe <in> --dir <dir> ...`: it records its args, writes the CLI's flat array and
// prints the CLI's --json line naming `cliEngine`.
function runScript(engine, cliEngine) {
  const root = mkdtempSync(join(tmpdir(), "media-use-transcribe-"));
  try {
    const cli = join(root, "cli.mjs");
    writeFileSync(
      cli,
      `import { writeFileSync } from "node:fs";\nconst a = process.argv.slice(2);\n` +
        `writeFileSync(${JSON.stringify(join(root, "args"))}, a.join(" "));\n` +
        `writeFileSync(a[a.indexOf("--dir") + 1] + "/transcript.json", ` +
        `'[{"text":"a","start":0,"end":1},{"text":"b","start":1,"end":2}]');\n` +
        `console.log('{"ok":true,"engine":"${cliEngine}"}');\n`,
    );
    const input = join(root, "in.wav");
    writeFileSync(input, "");
    const script = fileURLToPath(new URL("./transcribe.mjs", import.meta.url));
    const env = { ...process.env, HYPERFRAMES_CLI_ENTRY: cli, HOME: root };
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
      const cli = join(bin, "cli.mjs");
      writeFileSync(cli, `console.log('{"ok":false,"error":"${reason}"}');\nprocess.exit(1);\n`);
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
            HYPERFRAMES_CLI_ENTRY: cli,
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

test(
  "without a handed-over CLI it fails with the fix instead of running npx in the project",
  { skip: process.platform === "win32" },
  () => {
    const root = mkdtempSync(join(tmpdir(), "media-use-transcribe-"));
    try {
      const bin = join(root, "bin");
      mkdirSync(bin);
      const marker = join(root, "npx-ran");
      writeFileSync(join(bin, "npx"), `#!/bin/sh\ntouch "${marker}"\n`);
      chmodSync(join(bin, "npx"), 0o755);
      const input = join(root, "in.wav");
      writeFileSync(input, "");
      const script = fileURLToPath(new URL("./transcribe.mjs", import.meta.url));
      const env = {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        HOME: root,
        HYPERFRAMES_MEDIA_HOME: join(root, "home"),
        HYPERFRAMES_NO_TELEMETRY: "1",
      };
      delete env.HYPERFRAMES_PARAKEET;
      delete env.HYPERFRAMES_CLI_ENTRY;
      const res = spawnSync(
        process.execPath,
        [script, "--input", input, "--engine", "whisper", "--json"],
        { cwd: root, encoding: "utf8", env },
      );
      assert.equal(res.status, 1);
      assert.match(JSON.parse(res.stdout.trim()).error, /HYPERFRAMES_CLI_ENTRY/);
      assert.equal(existsSync(marker), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
