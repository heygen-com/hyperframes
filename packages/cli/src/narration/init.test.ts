import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { lintProject } from "@hyperframes/lint";
import { runCommand } from "citty";
import { consumeCommandResult } from "../utils/commandResult.js";
import { historyDeps } from "../utils/historyOwner.js";

const { runNarrationInit } = await import("./init.js");
const { default: narrationCommand } = await import("../commands/narration.js");

interface Line {
  id: string;
  text: string;
  start: number;
}

const LINES: Line[] = [
  { id: "l1", text: "Hello there", start: 0 },
  { id: "l2", text: "Fourteen renewals", start: 2 },
  { id: "l3", text: "Start here", start: 4 },
];

const durationOf = (text: string) => text.split(/\s+/).length * 0.4 + 0.2;
const wordsOf = (text: string) =>
  text.split(/\s+/).map((word, index) => ({
    text: word,
    start: 0.1 + index * 0.4,
    end: 0.4 + index * 0.4,
  }));

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * A project media-use voiced before narration.json existed: three clips, untagged; caption words
 * at each clip; audio_meta.json and audio_request.json as media-use leaves them.
 */
function project({ tagged = false, mediaUse = true } = {}) {
  const dir = tempDir("hf-narration-init-");
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  };
  const clips = LINES.map(
    (line) =>
      `<audio id="vo-${line.id}" src="assets/voice/${line.id}.wav" data-start="${line.start}" data-duration="${durationOf(line.text)}" data-track-index="1"${tagged ? ` data-narration-line="${line.id}"` : ""}></audio>`,
  ).join("\n    ");
  const captions = LINES.flatMap((line) =>
    wordsOf(line.text).map((word) => ({
      text: word.text,
      start: Number((line.start + word.start).toFixed(3)),
      end: Number((line.start + word.end).toFixed(3)),
    })),
  );
  write(
    "index.html",
    `<!doctype html><html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="10">
    ${clips}
  </div>
  <script>
    const TRANSCRIPT = ${JSON.stringify(captions, null, 2)};
    window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });
  </script>
</body></html>`,
  );
  for (const line of LINES) write(`assets/voice/${line.id}.wav`, `WAV:${line.text}`);
  if (mediaUse) {
    write(
      "audio_request.json",
      JSON.stringify({
        voice: "af_heart",
        lang: "en-us",
        lines: LINES.map(({ id, text }) => ({ id, text: `${text}.` })),
      }),
    );
    write(
      "audio_meta.json",
      JSON.stringify({
        tts_provider: "kokoro",
        voice_id: "af_heart",
        voices: LINES.map((line) => ({
          id: line.id,
          path: `assets/voice/${line.id}.wav`,
          duration_s: durationOf(line.text),
          words: wordsOf(line.text),
        })),
      }),
    );
  }
  const read = (path: string) => readFileSync(join(dir, path), "utf8");
  return { dir, read, write };
}

async function narrationFindings(dir: string) {
  const { results } = await lintProject(dir);
  return results
    .flatMap((entry) => entry.result.findings)
    .filter((finding) => finding.code.startsWith("narration_"))
    .map((finding) => finding.code);
}

/** Runs `hyperframes narration <args> --json`; returns its JSON and exit code. */
async function narration(args: string[]) {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  consumeCommandResult();
  await runCommand(narrationCommand, { rawArgs: [...args, "--json"] });
  const out = JSON.parse(String(log.mock.calls.at(-1)![0]));
  return { out, exitCode: consumeCommandResult().exitCode };
}

beforeEach(() => {
  historyDeps.historyRoot = tempDir("hf-narration-history-");
  historyDeps.findServer = async () => null;
});

afterEach(() => vi.restoreAllMocks());

describe("narration init", () => {
  it("adopts a media-use project: lines from audio_meta.json, text from the request, clips tagged", async () => {
    const { dir, read } = project();
    const result = await runNarrationInit({ dir });
    expect(result).toMatchObject({
      source: "media-use",
      lines: ["l1", "l2", "l3"],
      linked: ["l1", "l2", "l3"],
      unlinked: [],
      captions: "index.html",
    });
    expect(read("index.html")).toContain('data-narration-line="l2"');
    const manifest = JSON.parse(read("narration.json"));
    expect(manifest.defaults).toEqual({
      provider: "kokoro",
      voice: "af_heart",
      speed: 1,
      lang: "en-us",
    });
    expect(manifest.captions).toEqual({ file: "index.html", array: "TRANSCRIPT" });
    // The script only: lengths and word timings stay in audio_meta.json.
    expect(Object.keys(manifest.lines[1]).sort()).toEqual(["audio", "id", "text", "voiced"]);
    expect(manifest.lines[1]).toMatchObject({
      text: "Fourteen renewals.",
      audio: "assets/voice/l2.wav",
    });
    expect(await narrationFindings(dir)).toEqual([]);
  });

  it("refuses to replace narration.json unless forced", async () => {
    const { dir, read, write } = project();
    await runNarrationInit({ dir });
    await expect(runNarrationInit({ dir })).rejects.toThrow("already exists");
    write("narration.json", read("narration.json").replace("Fourteen renewals.", "Edited."));
    await runNarrationInit({ dir, force: true });
    expect(read("narration.json")).toContain("Fourteen renewals.");
  });

  it("adopts clips already tagged, taking each line's text from the captions inside its clip", async () => {
    const { dir, read } = project({ tagged: true, mediaUse: false });
    const result = await runNarrationInit({ dir });
    expect(result).toMatchObject({ source: "clips", lines: ["l1", "l2", "l3"] });
    const manifest = JSON.parse(read("narration.json"));
    expect(manifest.lines.map((line: { text: string }) => line.text)).toEqual(
      LINES.map((line) => line.text),
    );
    expect(await narrationFindings(dir)).toEqual([]);
  });

  it("refuses a project with nothing to adopt", async () => {
    const { dir } = project({ mediaUse: false });
    await expect(runNarrationInit({ dir })).rejects.toThrow("Nothing to adopt");
  });
});

describe("narration list and check", () => {
  it("lists each line with its length from audio_meta.json", async () => {
    const { dir } = project();
    await runNarrationInit({ dir });
    const { out, exitCode } = await narration(["list", "--dir", dir]);
    expect(exitCode).toBe(0);
    expect(
      out.lines.map((line: { id: string; durationSeconds: number }) => [
        line.id,
        line.durationSeconds,
      ]),
    ).toEqual([
      ["l1", 1],
      ["l2", 1],
      ["l3", 1],
    ]);
  });

  it("shows no length without audio_meta.json", async () => {
    const { dir } = project({ tagged: true, mediaUse: false });
    await runNarrationInit({ dir });
    const { out } = await narration(["list", "--dir", dir]);
    expect(out.lines[0].durationSeconds).toBeNull();
  });

  it("exits 1 with the drift as JSON, and 0 when in sync", async () => {
    const { dir, read, write } = project();
    await runNarrationInit({ dir });
    const clean = await narration(["check", "--dir", dir]);
    expect(clean.out.ok).toBe(true);
    expect(clean.exitCode).toBe(0);
    write(
      "narration.json",
      read("narration.json").replace("Fourteen renewals.", "Twenty renewals."),
    );
    const { out, exitCode } = await narration(["check", "--dir", dir]);
    expect(out.ok).toBe(false);
    expect(out.findings.map((f: { code: string; line: string }) => [f.code, f.line])).toEqual([
      ["narration_audio_stale", "l2"],
      ["narration_transcript_mismatch", "l2"],
    ]);
    expect(exitCode).toBe(1);
  });

  it("refuses, with exit 2, a project without narration.json", async () => {
    const { dir } = project();
    const { out, exitCode } = await narration(["check", "--dir", dir]);
    expect(exitCode).toBe(2);
    expect(JSON.stringify(out)).toContain("narration init");
  });
});
