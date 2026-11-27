// A music job from the launcher to wait-bgm, over a track the engine made earlier. Real here: the launcher, the
// script it builds, the save (save_track, and write_wav from lyria-recipe.py) and wait-bgm. Stood in: numpy,
// soundfile, torch and the MusicGen model, and the Lyria session, none of which a test machine has.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { appendRecord } from "../../../scripts/lib/manifest.mjs";
import { generateBgmDetached } from "./bgm.mjs";

const scripts = fileURLToPath(new URL("..", import.meta.url));
const python = ["python3", "python"].find(
  (name) => spawnSync(name, ["-c", "import sys; assert sys.version_info >= (3, 8)"]).status === 0,
);
const skip = !python || process.platform === "win32" || process.getuid() === 0;

const STAND_INS = {
  "torch.py": "",
  "numpy.py": `
class Arr(list):
    shape = property(lambda self: (len(self),))
    def __getitem__(self, at): return Arr(list.__getitem__(self, at)) if isinstance(at, slice) else list.__getitem__(self, at)
    def copy(self): return Arr(self)
    def astype(self, kind): return self
    def __mul__(self, by): return Arr(a * b for a, b in zip(self, by)) if isinstance(by, list) else Arr(a * by for a in self)
    __imul__ = __mul__
    def __truediv__(self, by): return Arr(a / by for a in self)
def linspace(start, stop, count, dtype=None): return Arr(start + (stop - start) * i / (count - 1) for i in range(count))
def abs(arr): return Arr(-a if a < 0 else a for a in arr)
max = max
`,
  "soundfile.py": `
def write(file, data, rate, format=None): file.write(b"RIFF" + bytes(len(data)))
`,
  "transformers.py": `
import numpy
class _Audio:
    def __getitem__(self, at): return self
    detach = cpu = lambda self: self
    def numpy(self): return numpy.Arr([0.5] * 1000)
class _Model:
    class config:
        class audio_encoder: sampling_rate = 100
    def eval(self): pass
    def generate(self, **inputs): return _Audio()
class MusicgenForConditionalGeneration:
    from_pretrained = staticmethod(lambda name: _Model())
class AutoProcessor:
    from_pretrained = staticmethod(lambda name: (lambda **inputs: {}))
`,
  "google/__init__.py": "",
  "google/genai.py": "",
  // The recipe's own write_wav, with stand-in audio where the Lyria session would have filled the buffer.
  "lyria-stand-in.py": `
import runpy, sys
from pathlib import Path
recipe = runpy.run_path(${JSON.stringify(join(scripts, "lyria-recipe.py"))})
recipe["write_wav"](Path(sys.argv[sys.argv.index("--output") + 1]), bytes(8))
`,
};

/** A file's permissions and first bytes, read through one handle. */
function modeAndStart(path) {
  const file = openSync(path, "r");
  try {
    return [fstatSync(file).mode & 0o777, readFileSync(file).subarray(0, 4).toString("latin1")];
  } finally {
    closeSync(file);
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Runs one music job to its end in a project whose track name holds what `plant` puts there, then wait-bgm. */
async function runJob(t, provider, plant) {
  const dir = mkdtempSync(join(tmpdir(), "hf-bgm-launch-"));
  const kept = { ...process.env };
  t.after(() => {
    process.env = kept;
    rmSync(dir, { recursive: true, force: true });
  });
  const modules = join(dir, ".stand-ins");
  for (const [name, text] of Object.entries(STAND_INS)) {
    mkdirSync(join(modules, name, ".."), { recursive: true });
    writeFileSync(join(modules, name), text);
  }
  process.env.PYTHONPATH = modules;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  if (provider === "lyria") process.env.GEMINI_API_KEY = "stand-in";
  // The launcher installs what its Python cannot import, so the stand-ins must load before it is called.
  const loads = spawnSync(python, [
    "-c",
    "import transformers, soundfile, torch, numpy, google.genai",
  ]);
  assert.equal(loads.status, 0, String(loads.stderr));
  mkdirSync(join(dir, "assets/bgm"), { recursive: true });
  const track = join(dir, "assets/bgm/track.wav");
  plant(track, dir);

  const gen = generateBgmDetached({
    prompt: "calm",
    durationS: 5,
    hyperframesDir: dir,
    lyriaRecipe: provider === "lyria" ? join(modules, "lyria-stand-in.py") : null,
    anomalies: [],
  });
  assert.equal(gen.provider, provider);
  // a timer, not a blocking sleep: the ended job is only gone once this process has seen it end
  for (let i = 0; i < 1000 && alive(gen.pid); i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(alive(gen.pid), false, "the job did not end");

  writeFileSync(
    join(dir, "audio_meta.json"),
    JSON.stringify({
      bgm: { path: gen.path },
      bgm_pending: true,
      bgm_provider: gen.provider,
      bgm_pid: gen.pid,
      bgm_log: gen.log,
      bgm_replaces: gen.replaces,
    }),
  );
  const waited = spawnSync(
    process.execPath,
    [
      join(scripts, "wait-bgm.mjs"),
      "--audio-meta",
      join(dir, "audio_meta.json"),
      "--hyperframes",
      dir,
      "--timeout-ms",
      "0",
    ],
    { encoding: "utf8" },
  );
  assert.equal(waited.status, 0, waited.stderr);
  const status = JSON.parse(readFileSync(join(dir, "bgm_status.json"), "utf8")).status;
  return { dir, track, gen, status, log: readFileSync(gen.log, "utf8") };
}

/** The engine's own earlier track at the name, with `mode`: the launcher writes to that name again. */
const earlierTrack = (mode) => (track, dir) => {
  writeFileSync(track, "last run's track", { mode });
  appendRecord(dir, {
    id: "bgm_001",
    type: "bgm",
    path: "assets/bgm/track.wav",
    source: "generated",
  });
};

for (const provider of ["musicgen", "lyria"]) {
  // fails without the fix: the launcher removed the earlier track before the job ran, so the new one got default permissions.
  test(
    `a ${provider} job replaces the engine's earlier private track and keeps it private`,
    { skip },
    async (t) => {
      const { track, gen, status, log } = await runJob(t, provider, earlierTrack(0o600));
      assert.equal(gen.path, "assets/bgm/track.wav");
      assert.deepEqual(modeAndStart(track), [0o600, "RIFF"], log);
      assert.equal(status, "ready");
    },
  );

  // fails without the fix: the launcher removed the read-only track, and the job wrote a new one in its place.
  test(
    `a ${provider} job refuses the engine's earlier read-only track, which stays and is not reported ready`,
    { skip },
    async (t) => {
      const { track, status, log } = await runJob(t, provider, earlierTrack(0o444));
      assert.deepEqual(modeAndStart(track), [0o444, "last"], log);
      assert.match(log, /PermissionError/);
      assert.equal(status, "failed");
    },
  );

  test(
    `a ${provider} job leaves a link at the track name and what it names alone, and writes beside it`,
    { skip },
    async (t) => {
      const { dir, track, gen, status, log } = await runJob(t, provider, (at, project) => {
        writeFileSync(join(project, "other.txt"), "other");
        symlinkSync(join(project, "other.txt"), at);
      });
      assert.equal(gen.path, "assets/bgm/track-2.wav");
      assert.equal(lstatSync(track).isSymbolicLink(), true);
      assert.equal(readFileSync(join(dir, "other.txt"), "utf8"), "other");
      assert.equal(modeAndStart(join(dir, gen.path))[1], "RIFF", log);
      assert.equal(status, "ready");
    },
  );
}
