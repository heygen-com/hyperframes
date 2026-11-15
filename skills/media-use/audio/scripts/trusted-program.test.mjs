import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const scripts = fileURLToPath(new URL(".", import.meta.url));
// Absolute, because the tests below run it with a PATH that has no Python on it.
const python = ["python3", "python"]
  .map((name) =>
    spawnSync(
      name,
      ["-c", "import sys; assert sys.version_info >= (3, 9); print(sys.executable)"],
      {
        encoding: "utf8",
      },
    ),
  )
  .find((result) => result.status === 0)
  ?.stdout.trim();
const hasNumpy = python && spawnSync(python, ["-c", "import numpy"]).status === 0;
const exe = process.platform === "win32" ? ".exe" : "";

function program(dir, name, marker) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}${exe}`);
  writeFileSync(file, `#!/bin/sh\ntouch "${marker}"\nexit 1\n`);
  chmodSync(file, 0o755);
  return file;
}

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "hf-trusted-program-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, "project");
  const plantedRan = join(root, "planted-ran");
  for (const dir of [project, join(project, "bin"), join(project, "node_modules", ".bin")]) {
    program(dir, "ffmpeg", plantedRan);
  }
  const trusted = program(join(root, "tools"), "ffmpeg", join(root, "trusted-ran"));
  const projectOnly = ["", ".", "bin", "node_modules/.bin", join(project, "bin")].join(delimiter);
  return { project, plantedRan, trusted, projectOnly, tools: join(root, "tools") };
}

function find(cwd, path) {
  const code = `import sys; sys.path.insert(0, ${JSON.stringify(scripts)})
from trusted_program import find_program
try:
    print(find_program("ffmpeg"))
except FileNotFoundError as error:
    print("missing:", error)`;
  const result = spawnSync(python, ["-c", code], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, PATH: path },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test(
  "find_program skips every project folder on PATH and returns the trusted one",
  { skip: !python },
  (t) => {
    const { project, trusted, projectOnly, tools } = fixture(t);
    assert.equal(find(project, `${projectOnly}${delimiter}${tools}`), trusted);
  },
);

test(
  "find_program reports a miss like running a missing program by name",
  { skip: !python },
  (t) => {
    const { project, projectOnly } = fixture(t);
    assert.equal(
      find(project, projectOnly),
      "missing: [Errno 2] No such file or directory: 'ffmpeg'",
    );
  },
);

test(
  "extract-audio-data never runs an ffmpeg planted in the project",
  { skip: !hasNumpy || process.platform === "win32" },
  (t) => {
    const { project, plantedRan, projectOnly } = fixture(t);
    const result = spawnSync(
      python,
      [join(scripts, "extract-audio-data.py"), "in.mp3", "-o", "out.json"],
      { cwd: project, encoding: "utf8", env: { ...process.env, PATH: projectOnly } },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /No such file or directory: 'ffmpeg'/);
    assert.equal(existsSync(plantedRan), false);
  },
);
