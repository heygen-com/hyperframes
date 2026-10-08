import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { SHERPA_ERROR_PREFIX, SHERPA_RESULT_PREFIX, SHERPA_WINDOW_PREFIX } from "./parakeet.js";
import { encodeWav } from "./wav.test-helpers.js";

const WORKER = fileURLToPath(new URL("./sherpaWorker.ts", import.meta.url));

// Stand-in sherpa-onnx-node, 3 s of sound: the whole window (300 samples) drops the first 2 s; the
// padded window (350) hears it, and for speech.wav so does the padded gap +-0.5 s (308) alone.
const FAKE_SHERPA = `
const path = JSON.parse(process.env.HYPERFRAMES_PARAKEET_INPUT).wavPath;
module.exports = {
  // What Electron's V8 sandbox throws for this reader's native buffer: the worker reads the WAV itself.
  readWave() { throw new Error("External buffers are not allowed"); },
  OfflineRecognizer: class {
    constructor() {
      if (path.endsWith("lines.wav")) throw new Error("Could not find it. Tried\\n\\n  ../a.node\\n  ./b.node\\n");
      if (process.env.STARTED) require("fs").writeFileSync(process.env.STARTED, "");
    }
    createStream() { return { acceptWaveform(w) { this.w = w; } }; }
    decode() {
      if (path.endsWith("long.wav")) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    }
    getResult(stream) {
      const n = stream.w.samples.length;
      if (n === 300) return { tokens: [" not"], timestamps: [2.08], durations: [0.4] };
      if (n === 350) return { tokens: [" ask", " not"], timestamps: [0.75, 1.5], durations: [0.4, 0.4] };
      return n === 308 && path.endsWith("speech.wav")
        ? { tokens: [" ask", " not"], timestamps: [1, 2.58], durations: [0.4, 0.4] }
        : { tokens: [], timestamps: [], durations: [] };
    }
  },
};
`;

function runWorker(runtimeDir: string, wavPath: string) {
  const input = JSON.stringify({
    wavPath,
    runtimePath: join(runtimeDir, "node_modules", "sherpa-onnx-node", "index.js"),
    config: {},
  });
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    execFile(
      process.execPath,
      ["--import", "tsx", WORKER],
      { env: { ...process.env, HYPERFRAMES_PARAKEET_INPUT: input } },
      (err, stdout, stderr) => resolve({ code: err ? (err.code as number) : 0, stdout, stderr }),
    );
  });
}

describe("sherpaWorker", () => {
  let root: string;
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function fakeRuntime(): string {
    root = mkdtempSync(join(tmpdir(), "hf-sherpa-worker-"));
    const pkg = join(root, "node_modules", "sherpa-onnx-node");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "package.json"), '{"name":"sherpa-onnx-node","main":"index.js"}');
    writeFileSync(join(pkg, "index.js"), FAKE_SHERPA);
    return root;
  }

  /** 3 s of steady sound at 100 Hz, as the stand-in decoder expects; long.wav is 600 s of silence. */
  function wav(name: string): string {
    const samples = name === "long.wav" ? new Float32Array(60000) : new Float32Array(300).fill(0.5);
    writeFileSync(join(root, name), encodeWav(samples, 100));
    return join(root, name);
  }

  function windowsOf(stdout: string) {
    const line = stdout.split("\n").find((l) => l.startsWith(SHERPA_RESULT_PREFIX))!;
    return JSON.parse(line.slice(SHERPA_RESULT_PREFIX.length));
  }

  it("decodes a gap that skipped loud audio on its own and splices in its new tokens", async () => {
    const { code, stdout } = await runWorker(fakeRuntime(), wav("speech.wav"));
    expect(code).toBe(0);
    expect(windowsOf(stdout)).toEqual([
      { offset: 0, tokens: [" ask", " not"], timestamps: [0.5, 2.08], durations: [0.4, 0.4] },
    ]);
  });

  it("prints each window as it is decoded, with the audio seconds done", async () => {
    const { stdout } = await runWorker(fakeRuntime(), wav("speech.wav"));
    const streamed = stdout
      .split("\n")
      .filter((l) => l.startsWith(SHERPA_WINDOW_PREFIX))
      .map((l) => JSON.parse(l.slice(SHERPA_WINDOW_PREFIX.length)));
    expect(streamed).toEqual([{ window: windowsOf(stdout)[0], through: 3 }]);
  });

  it("re-decodes the window with leading silence when the gap alone gives nothing", async () => {
    const { code, stdout } = await runWorker(fakeRuntime(), wav("hum.wav"));
    expect(code).toBe(0);
    expect(windowsOf(stdout)).toEqual([
      { offset: 0, tokens: [" ask", " not"], timestamps: [0.25, 1], durations: [0.4, 0.4] },
    ]);
  });

  it("exits non-zero with one prefixed error line when it cannot read the audio", async () => {
    const broken = join(fakeRuntime(), "broken.wav");
    writeFileSync(broken, "not audio");
    const { code, stderr } = await runWorker(root, broken);
    expect(code).toBe(1);
    expect(stderr).toContain(`${SHERPA_ERROR_PREFIX}${broken} is not a 16-bit mono PCM WAV`);
  });

  it.each([0, 1])("names the audio file when its fmt chunk has only %i bytes", async (size) => {
    const broken = join(fakeRuntime(), "short.wav");
    const bytes = encodeWav([], 16_000).subarray(0, 20 + size);
    bytes.writeUInt32LE(size, 16);
    writeFileSync(broken, bytes);
    const { code, stderr } = await runWorker(root, broken);
    expect(code).toBe(1);
    const errors = stderr.split("\n").filter((line) => line.startsWith(SHERPA_ERROR_PREFIX));
    expect(errors).toEqual([`${SHERPA_ERROR_PREFIX}${broken} is not a 16-bit mono PCM WAV`]);
  });

  it("keeps every line of a multi-line error on its one prefixed line", async () => {
    const { code, stderr } = await runWorker(fakeRuntime(), "lines.wav");
    expect(code).toBe(1);
    expect(stderr).toContain(`${SHERPA_ERROR_PREFIX}Could not find it. Tried ../a.node ./b.node\n`);
  });

  it.skipIf(process.platform === "win32")(
    "stops between windows once the CLI that spawned it is gone",
    async () => {
      const started = join(fakeRuntime(), "started");
      const input = JSON.stringify({
        wavPath: wav("long.wav"),
        runtimePath: join(root, "node_modules", "sherpa-onnx-node", "index.js"),
        config: {},
      });
      // The shell waits for the first window, then exits, orphaning a 10-window decode.
      const shell =
        `"${process.execPath}" --import tsx "${WORKER}" >/dev/null 2>&1 & echo $!; ` +
        `while [ ! -e "${started}" ]; do sleep 0.1; done`;
      const pid = await new Promise<number>((resolve) =>
        execFile(
          "sh",
          ["-c", shell],
          { env: { ...process.env, HYPERFRAMES_PARAKEET_INPUT: input, STARTED: started } },
          (_e, out) => resolve(Number(out.trim())),
        ),
      );
      const alive = () => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      };
      const deadline = Date.now() + 4000;
      while (alive() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
      const orphanSurvived = alive();
      if (orphanSurvived) process.kill(pid, "SIGKILL");
      expect(orphanSurvived).toBe(false);
    },
    15_000,
  );

  it("names the missing runtime when sherpa-onnx-node is not installed", async () => {
    root = mkdtempSync(join(tmpdir(), "hf-sherpa-worker-"));
    const { code, stderr } = await runWorker(root, "speech.wav");
    expect(code).toBe(1);
    expect(stderr).toContain(
      `${SHERPA_ERROR_PREFIX}Cannot find module '${join(root, "node_modules", "sherpa-onnx-node", "index.js")}'`,
    );
  });
});
