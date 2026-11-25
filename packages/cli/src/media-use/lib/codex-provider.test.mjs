import test from "node:test";
import assert from "node:assert";
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
import { basename, delimiter, dirname, join } from "node:path";
import { codexImageGenerate, imageGenFlag } from "./codex-provider.mjs";

// A stand-in `codex` on PATH: `features list` offers the image tool; `exec` records its
// arguments, renders nothing, and plants a file where an attacker could (EVIL_PATH).
// With CODEX_FAIL set, `exec` fails with a terminal control sequence on stderr.
function fakeCodex(t) {
  const root = mkdtempSync(join(tmpdir(), "fake-codex-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "codex"),
    [
      "#!/bin/sh",
      'case "$1" in',
      '  features) echo "image_generation   stable   true" ;;',
      '  exec) printf "%s\\n" "$@" > "$CODEX_LOG"; cat > /dev/null;',
      '        [ -n "$CODEX_FAIL" ] && { printf "refused \\033]0;title\\007 a red cube\\r\\nsecond \\rline\\n" >&2; exit 1; }',
      '        [ -n "$EVIL_PATH" ] && printf EVIL > "$EVIL_PATH" ;;',
      "esac",
      "",
    ].join("\n"),
  );
  chmodSync(join(bin, "codex"), 0o755);
  const codexHome = join(root, "codex-home");
  mkdirSync(codexHome);
  writeFileSync(join(codexHome, "auth.json"), "{}");
  const saved = { PATH: process.env.PATH, CODEX_HOME: process.env.CODEX_HOME };
  process.env.PATH = `${bin}${delimiter}${process.env.PATH}`;
  process.env.CODEX_HOME = codexHome;
  process.env.CODEX_LOG = join(root, "exec.log");
  t.after(() => {
    process.env.PATH = saved.PATH;
    if (saved.CODEX_HOME === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = saved.CODEX_HOME;
    if (process.env.EVIL_PATH) rmSync(process.env.EVIL_PATH, { force: true });
    delete process.env.CODEX_LOG;
    delete process.env.EVIL_PATH;
    rmSync(root, { recursive: true, force: true });
  });
  return () => readFileSync(process.env.CODEX_LOG, "utf8").trim().split("\n");
}

const posixOnly = { skip: process.platform === "win32" };

test(
  "codex works in a fresh private temp folder and is told not to look above it",
  posixOnly,
  async (t) => {
    const execLog = fakeCodex(t);
    assert.equal(await codexImageGenerate("a red cube"), null);
    const args = execLog();
    const cwd = args[args.indexOf("--cd") + 1];
    assert.equal(dirname(cwd), tmpdir());
    assert.match(basename(cwd), /^media-use-codex-/);
    assert.deepEqual(args.slice(args.indexOf("--cd"), args.indexOf("--cd") + 4), [
      "--cd",
      cwd,
      "-c",
      "project_root_markers=[]",
    ]);
    assert.equal(existsSync(cwd), false, "a folder with no image is removed");
  },
);

test(
  "a file planted at the old guessable temp path is not taken as the image",
  posixOnly,
  async (t) => {
    fakeCodex(t);
    const now = 1_700_000_000_000;
    t.mock.method(Date, "now", () => now);
    process.env.EVIL_PATH = join(tmpdir(), `media-use-codex-${process.pid}-${now}.png`);
    assert.equal(await codexImageGenerate("a red cube"), null);
  },
);

// Real `codex features list` output is three space-padded columns:
//   <name> <stage> <enabled>
const OLD_CLI = [
  "image_detail_original               removed            false",
  "image_generation                    stable             true",
  "imagegenext                         under development  false",
].join("\n");

const NEW_CLI = [
  "image_detail_original               removed            false",
  "image_generation                    stable             true",
].join("\n");

test("older CLIs keep the old flag — they reject --enable image_generation", () => {
  assert.equal(imageGenFlag(OLD_CLI), "imagegenext");
});

test("Codex CLI >=0.145 dropped the imagegenext row; fall back to its new name", () => {
  // The regression this guards: gating on `imagegenext` alone made the provider
  // report "unavailable" on every up-to-date CLI, without attempting a render.
  assert.equal(imageGenFlag(NEW_CLI), "image_generation");
});

test("no image feature at all is unavailable, not a silent default", () => {
  assert.equal(imageGenFlag("apps  stable  true\nhooks  stable  true"), null);
});

test("substring lookalikes do not count as the feature row", () => {
  assert.equal(imageGenFlag("image_generation_v2  stable  true"), null);
});

test(
  "a failed codex exec prints its output line by line with control characters escaped",
  posixOnly,
  async (t) => {
    fakeCodex(t);
    process.env.CODEX_FAIL = "1";
    t.after(() => delete process.env.CODEX_FAIL);
    const errors = [];
    t.mock.method(console, "error", (message) => errors.push(message));

    assert.equal(await codexImageGenerate("a red cube"), null);

    assert.deepEqual(errors, [
      "media-use: `codex exec` image generation failed: refused \\x1b]0;title\\x07 a red cube\nsecond \\x0dline",
    ]);
  },
);
