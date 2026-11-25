import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appendRecord } from "../../../scripts/lib/manifest.mjs";
import {
  BGM_BED_VOLUME,
  BGM_SILENT_VOLUME,
  bgmDefaultVolume,
  generateBgmDetached,
  SAVE_TRACK_PY,
} from "./bgm.mjs";

// Regression: narrated pipelines used to ship BGM at 0.8 (≈ -2 dB), ~16 dB
// hotter than a music bed under a voice should be. The default under narration
// must be a proper bed (≈ -18 dB); a silent film keeps the louder default.

const dbfs = (linear) => 20 * Math.log10(linear);

// fails without the fix: MusicGen started in the project, and transformers reads
// "facebook/musicgen-small" as a folder when the working directory has one.
test(
  "local MusicGen starts in the home folder, so a project folder named like the model is never read",
  { skip: process.platform === "win32" ? "the stand-in python is an sh script" : false },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "bgm-musicgen-cwd-"));
    try {
      const home = join(root, "home");
      const project = join(root, "project");
      mkdirSync(home);
      mkdirSync(join(project, "facebook", "musicgen-small"), { recursive: true });
      const python = join(root, "python");
      const record = join(root, "record");
      writeFileSync(
        python,
        `#!/bin/sh\ncase "$*" in --version) echo "Python 3.12.0";; *from_pretrained*) printf '%s' "$PWD" > "${record}";; esac\nexit 0\n`,
        { mode: 0o755 },
      );
      const bgm = new URL("./bgm.mjs", import.meta.url).href;
      const ran = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `const { generateBgmDetached } = await import(${JSON.stringify(bgm)});
           const meta = generateBgmDetached({ prompt: "calm", durationS: 5, hyperframesDir: process.cwd(), hasVoice: false });
           console.log(JSON.stringify(meta));`,
        ],
        {
          cwd: project,
          encoding: "utf8",
          env: {
            ...process.env,
            HOME: home,
            HYPERFRAMES_PYTHON: python,
            GEMINI_API_KEY: "",
            GOOGLE_API_KEY: "",
          },
        },
      );
      assert.equal(ran.status, 0, ran.stderr);
      assert.equal(JSON.parse(ran.stdout).provider, "musicgen", ran.stdout);
      for (let i = 0; i < 50 && !existsSync(record); i++)
        assert.equal(existsSync(record), true, "the stand-in python never received the script");
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(readFileSync(record, "utf8"), realpathSync(home));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

// fails without the fix: a project .env's Gemini key generated music with no note.
test(
  "Lyria music with a project .env's Gemini key prints one note naming the file",
  { skip: process.platform === "win32" ? "the stand-in python is an sh script" : false },
  () => {
    const root = mkdtempSync(join(tmpdir(), "bgm-project-key-"));
    try {
      const project = join(root, "project");
      mkdirSync(project);
      writeFileSync(join(project, ".env"), "GEMINI_API_KEY=from-project\n");
      const python = join(root, "python");
      writeFileSync(
        python,
        `#!/bin/sh\ncase "$*" in --version) echo "Python 3.12.0";; esac\nexit 0\n`,
        {
          mode: 0o755,
        },
      );
      const recipe = join(root, "lyria-recipe.py");
      writeFileSync(recipe, "");
      const env = { ...process.env, HOME: root, HYPERFRAMES_PYTHON: python };
      for (const name of [
        "GEMINI_API_KEY",
        "GOOGLE_API_KEY",
        "GOOGLE_APPLICATION_CREDENTIALS",
        "GCS_CREDS",
        "HYPERFRAMES_PROJECT_ENV_ORIGINS",
      ])
        delete env[name];
      const bgm = new URL("./bgm.mjs", import.meta.url).href;
      const heygen = new URL("./heygen.mjs", import.meta.url).href;
      const ran = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `const { generateBgmDetached } = await import(${JSON.stringify(bgm)});
           const { loadEnvFromDir } = await import(${JSON.stringify(heygen)});
           loadEnvFromDir(process.cwd());
           for (let i = 0; i < 2; i++) {
             const meta = generateBgmDetached({ prompt: "calm", durationS: 5, hyperframesDir: process.cwd(), lyriaRecipe: ${JSON.stringify(recipe)}, hasVoice: false });
             console.log(meta.provider);
           }`,
        ],
        { cwd: project, encoding: "utf8", env },
      );
      assert.equal(ran.status, 0, ran.stderr);
      assert.equal(ran.stdout, "lyria\nlyria\n");
      const notes = ran.stderr.match(/\[hyperframes\] Using GEMINI_API_KEY from .*/g) ?? [];
      assert.equal(notes.length, 1, ran.stderr);
      assert.match(
        notes[0],
        /\.env, a project \.env: music requests go to that key's Gemini account\.$/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test("BGM under narration is a bed near -18 dB", () => {
  assert.equal(bgmDefaultVolume(true), BGM_BED_VOLUME);
  assert.equal(BGM_BED_VOLUME, 0.12);
  const db = dbfs(BGM_BED_VOLUME);
  assert.ok(db < -17 && db > -19, `bed should be ≈ -18 dB, got ${db.toFixed(1)} dB`);
});

test("a silent film (no voice) keeps BGM forward", () => {
  assert.equal(bgmDefaultVolume(false), BGM_SILENT_VOLUME);
  assert.equal(BGM_SILENT_VOLUME, 0.9);
});

test("the narrated default is well below the voice (≈ 0 dBFS)", () => {
  // Voice sits at data-volume="1" (0 dBFS); the bed must be ~16+ dB under it.
  const separation = dbfs(1) - dbfs(bgmDefaultVolume(true));
  assert.ok(
    separation >= 16,
    `bed should sit ≥16 dB under the voice, got ${separation.toFixed(1)} dB`,
  );
});

test(
  "generating music again leaves the engine's old track in place and names it, so waiting can tell it from the new one",
  { skip: process.platform === "win32" && "the fake python is a shell script" },
  (t) => {
    const dir = mkdtempSync(join(tmpdir(), "hf-bgm-"));
    const path = process.env.PATH;
    t.after(() => {
      process.env.PATH = path;
      rmSync(dir, { recursive: true, force: true });
    });
    mkdirSync(join(dir, "bin"));
    for (const name of ["python3", "python"])
      writeFileSync(join(dir, "bin", name), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    process.env.PATH = `${join(dir, "bin")}:${path}`;
    mkdirSync(join(dir, "assets/bgm"), { recursive: true });
    writeFileSync(join(dir, "assets/bgm/track.wav"), "last run's track");
    appendRecord(dir, {
      id: "bgm_001",
      type: "bgm",
      path: "assets/bgm/track.wav",
      source: "generated",
    });

    const gen = generateBgmDetached({
      prompt: "calm",
      durationS: 5,
      hyperframesDir: dir,
      anomalies: [],
    });

    assert.equal(gen.path, "assets/bgm/track.wav");
    const old = lstatSync(join(dir, "assets/bgm/track.wav"));
    assert.deepEqual(gen.replaces, { ino: old.ino, size: old.size, mtime_ms: old.mtimeMs });
  },
);

const python = ["python3", "python"].find(
  (name) => spawnSync(name, ["-c", "import sys; assert sys.version_info >= (3, 8)"]).status === 0,
);
// The save as the local music script runs it; the model before it is not what is under test.
const SAVE = `${SAVE_TRACK_PY}
import sys
def write(f):
    f.write(b"track")
    if sys.argv[2] == "fail": raise RuntimeError("stopped mid-write")
save_track(sys.argv[1], write)`;

for (const [kind, plant] of [
  ["symbolic link", (target, at) => symlinkSync(target, at)],
  ["dangling symbolic link", (target, at) => symlinkSync(`${target}.missing`, at)],
  ["hard link", (target, at) => linkSync(target, at)],
]) {
  // fails without the fix: the script wrote straight to the name, through whatever sat there.
  test(
    `the local music script replaces a ${kind} at the track name, never its target`,
    { skip: !python },
    (t) => {
      const dir = mkdtempSync(join(tmpdir(), "bgm-save-"));
      t.after(() => rmSync(dir, { recursive: true, force: true }));
      const other = join(dir, "other.txt");
      writeFileSync(other, "other");
      const out = join(dir, "track.wav");
      plant(other, out);
      const ran = spawnSync(python, ["-c", SAVE, out, "ok"], { encoding: "utf8" });
      assert.equal(ran.status, 0, ran.stderr);
      assert.equal(readFileSync(other, "utf8"), "other");
      const entry = lstatSync(out);
      assert.equal(entry.isFile(), true);
      assert.equal(entry.nlink, 1);
      assert.equal(modeAndText(out)[1], "track");
      assert.deepEqual(readdirSync(dir).sort(), ["other.txt", "track.wav"]);
    },
  );
}

/** A file's permissions and text, read through one handle. */
function modeAndText(path) {
  const file = openSync(path, "r");
  try {
    return [fstatSync(file).mode & 0o777, readFileSync(file, "utf8")];
  } finally {
    closeSync(file);
  }
}

const posix = process.platform !== "win32";
/** Runs the save over a track made with `mode`, with python's umask at 027. */
function saveOver(t, mode) {
  const dir = mkdtempSync(join(tmpdir(), "bgm-save-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const out = join(dir, "track.wav");
  if (mode !== undefined) writeFileSync(out, "old", { mode });
  const seen = `import os
os.umask(0o027)
real = os.fchmod
def fchmod(fd, mode):
    print(oct(os.fstat(fd).st_mode & 0o777), oct(mode))
    real(fd, mode)
os.fchmod = fchmod
${SAVE}`;
  return { dir, out, ran: spawnSync(python, ["-c", seen, out, "ok"], { encoding: "utf8" }) };
}

// fails without the fix: the new file was published with default permissions, so a private track became readable by others.
test(
  "the local music script keeps the permissions of the track it replaces",
  { skip: !python || !posix },
  (t) => {
    const { dir, out, ran } = saveOver(t, 0o600);
    assert.equal(ran.status, 0, ran.stderr);
    assert.deepEqual(modeAndText(out), [0o600, "track"]);
    assert.deepEqual(readdirSync(dir), ["track.wav"]);
  },
);

// fails without the fix: the rename replaced a track that may not be written, which the write in place refused.
test(
  "the local music script refuses a read-only track and leaves it as it was",
  { skip: !python || !posix || process.getuid() === 0 },
  (t) => {
    const { dir, out, ran } = saveOver(t, 0o444);
    assert.notEqual(ran.status, 0);
    assert.match(ran.stderr, /PermissionError/);
    assert.deepEqual(modeAndText(out), [0o444, "old"]);
    assert.deepEqual(readdirSync(dir), ["track.wav"]);
  },
);

// fails without the fix: the temp file was created with default permissions and published as it was.
test(
  "the local music script keeps its temp file owner-only and gives a new track the default permissions",
  { skip: !python || !posix },
  (t) => {
    const { out, ran } = saveOver(t, undefined);
    assert.equal(ran.status, 0, ran.stderr);
    assert.equal(ran.stdout.trim(), "0o600 0o640");
    assert.equal(modeAndText(out)[0], 0o640);
  },
);

// fails without the fix: a write that stopped part-way left a short file at the name, which wait-bgm took as the track.
test(
  "a local music write that stops part-way leaves no track and no temp file",
  { skip: !python },
  (t) => {
    const dir = mkdtempSync(join(tmpdir(), "bgm-save-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const ran = spawnSync(python, ["-c", SAVE, join(dir, "track.wav"), "fail"], {
      encoding: "utf8",
    });
    assert.notEqual(ran.status, 0);
    assert.match(ran.stderr, /stopped mid-write/);
    assert.deepEqual(readdirSync(dir), []);
  },
);

// fails without the fix: the script handed to python wrote with sf.write(out_path, ...).
test(
  "the local music script saves its track through save_track",
  { skip: process.platform === "win32" ? "the stand-in python is an sh script" : false },
  (t) => {
    const dir = mkdtempSync(join(tmpdir(), "hf-bgm-"));
    const path = process.env.PATH;
    t.after(() => {
      process.env.PATH = path;
      rmSync(dir, { recursive: true, force: true });
    });
    mkdirSync(join(dir, "bin"));
    const record = join(dir, "script.py");
    for (const name of ["python3", "python"])
      writeFileSync(
        join(dir, "bin", name),
        `#!/bin/sh\n[ "$1" = "-c" ] && case "$2" in *from_pretrained*) printf '%s' "$2" > "${record}.part" && mv "${record}.part" "${record}";; esac\nexit 0\n`,
        { mode: 0o755 },
      );
    process.env.PATH = `${join(dir, "bin")}:${path}`;
    const gen = generateBgmDetached({
      prompt: "calm",
      durationS: 5,
      hyperframesDir: dir,
      anomalies: [],
    });
    assert.equal(gen.provider, "musicgen");
    for (let i = 0; i < 200 && !existsSync(record); i++) spawnSync("sleep", ["0.01"]);
    const script = readFileSync(record, "utf8");
    assert.match(script, /def save_track\(out_path, write\):/);
    assert.match(
      script,
      /save_track\(out_path, lambda f: sf\.write\(f, final, sr, format="WAV"\)\)/,
    );
    assert.doesNotMatch(script, /sf\.write\(out_path/);
  },
);
