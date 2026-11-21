import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findFFprobe } from "../browser/ffmpeg.js";
import * as manager from "./manager.js";
import { transcribe } from "./transcribe.js";
import { encodeWav } from "./wav.test-helpers.js";

// A shebang script stands in for whisper-cli, and a 16 kHz WAV passes through only after ffprobe reads it.
describe.skipIf(process.platform === "win32" || !findFFprobe())("whisper transcribe output", () => {
  let dir: string;
  let outside: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hf-whisper-output-"));
    outside = mkdtempSync(join(tmpdir(), "hf-whisper-outside-"));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it("has whisper write outside the project and replaces a link at transcript.json", async () => {
    const seen = join(outside, "output-file");
    const whisperCli = join(outside, "whisper-cli");
    const json = { transcription: [{ tokens: [{ text: " Hi", offsets: { from: 0, to: 500 } }] }] };
    writeFileSync(
      whisperCli,
      `#!${process.execPath}
const fs = require("fs");
const args = process.argv.slice(2);
const base = args[args.indexOf("--output-file") + 1];
fs.writeFileSync(${JSON.stringify(seen)}, base);
fs.writeFileSync(base + ".json", ${JSON.stringify(JSON.stringify(json))});
`,
    );
    chmodSync(whisperCli, 0o755);
    vi.spyOn(manager, "ensureWhisper").mockResolvedValue({
      executablePath: whisperCli,
      source: "system",
    });
    vi.spyOn(manager, "ensureModel").mockResolvedValue(join(outside, "ggml-small.en.bin"));
    const input = join(dir, "narration.wav");
    writeFileSync(input, encodeWav(new Float32Array(16000), 16000));
    const target = join(outside, "authorized_keys");
    writeFileSync(target, "keep me\n");
    const transcriptPath = join(dir, "transcript.json");
    symlinkSync(target, transcriptPath);

    const result = await transcribe(input, dir);

    expect(readFileSync(target, "utf8")).toBe("keep me\n");
    expect(JSON.parse(readFileSync(transcriptPath, "utf8"))).toEqual(json);
    expect(result).toMatchObject({ transcriptPath, wordCount: 1 });
    const whisperFolder = dirname(readFileSync(seen, "utf8"));
    expect(whisperFolder).not.toBe(dir);
    expect(existsSync(whisperFolder)).toBe(false);
  });
});
