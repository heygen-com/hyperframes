import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  linkSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const scripts = fileURLToPath(new URL(".", import.meta.url));
const python = ["python3", "python"].find(
  (name) => spawnSync(name, ["-c", "import sys; assert sys.version_info >= (3, 8)"]).status === 0,
);
// main() as the script runs it, with google.genai stubbed to stream one second of silence:
// the Lyria service is not what is under test.
const RUN = `import runpy, sys, types
class Session:
    async def __aenter__(self): return self
    async def __aexit__(self, *a): return False
    async def set_weighted_prompts(self, prompts): pass
    async def set_music_generation_config(self, config): pass
    async def play(self): pass
    async def receive(self):
        chunk = types.SimpleNamespace(data=bytes(48000 * 2 * 2))
        yield types.SimpleNamespace(server_content=types.SimpleNamespace(audio_chunks=[chunk]))
class Client:
    def __init__(self, **kw):
        self.aio = types.SimpleNamespace(live=types.SimpleNamespace(music=types.SimpleNamespace(connect=lambda model: Session())))
gtypes = types.SimpleNamespace(
    Scale=types.SimpleNamespace(MAJOR="MAJOR"),
    WeightedPrompt=lambda **kw: kw,
    LiveMusicGenerationConfig=lambda **kw: kw,
)
genai = types.ModuleType("google.genai")
genai.Client = Client
genai.types = gtypes
google = types.ModuleType("google")
google.genai = genai
sys.modules.update({"google": google, "google.genai": genai, "google.genai.types": gtypes})
main = runpy.run_path(sys.argv[1] + "/lyria-recipe.py")["main"]
sys.argv = ["lyria-recipe.py", "--output", sys.argv[2], "--duration", "1"]
main()`;

for (const [kind, plant] of [
  ["symbolic link", (target, at) => symlinkSync(target, at)],
  ["hard link", (target, at) => linkSync(target, at)],
]) {
  // fails without the fix: generate_bgm wrote with wave.open(path, "wb"), which truncates the target of a link at path.
  test(
    `lyria-recipe replaces a ${kind} at its --output, never its target`,
    { skip: !python },
    (t) => {
      const dir = mkdtempSync(join(tmpdir(), "lyria-link-"));
      t.after(() => rmSync(dir, { recursive: true, force: true }));
      const victim = join(dir, "victim.txt");
      writeFileSync(victim, "victim");
      const out = join(dir, "track.wav");
      plant(victim, out);
      const result = spawnSync(python, ["-c", RUN, scripts, out], {
        encoding: "utf8",
        env: { ...process.env, GEMINI_API_KEY: "test", GOOGLE_API_KEY: "" },
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(victim, "utf8"), "victim");
      const wav = readFileSync(out);
      assert.equal(wav.subarray(0, 4).toString("latin1"), "RIFF");
      assert.equal(wav.length, 44 + 48000 * 2 * 2);
      const entry = lstatSync(out);
      assert.equal(entry.isFile(), true);
      assert.equal(entry.nlink, 1);
      assert.deepEqual(readdirSync(dir).sort(), ["track.wav", "victim.txt"]);
    },
  );
}
