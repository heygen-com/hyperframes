import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "citty";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { probeAudio, decodeAudio } = vi.hoisted(() => ({
  probeAudio: vi.fn(async (_path: string) => null),
  decodeAudio: vi.fn(async (_path: string) => null),
}));
vi.mock("../audio/analysis/decode.js", async (original) => ({
  ...(await original<typeof import("../audio/analysis/decode.js")>()),
  probeAudio,
  decodeAudio,
}));

import audioCommand from "./audio.js";

const base = mkdtempSync(join(tmpdir(), "hf-audio-film-sources-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));

/** A project from someone else whose clips name a file outside it, above it and among its private files. */
function receivedProject(): { project: string; outside: string } {
  const project = mkdtempSync(join(base, "project-"));
  const outside = join(base, "secret.wav");
  writeFileSync(outside, "x");
  mkdirSync(join(project, ".hyperframes"));
  mkdirSync(join(project, "audio"));
  writeFileSync(join(project, ".hyperframes", "state.wav"), "x");
  writeFileSync(join(project, "audio", "vo.wav"), "x");
  // A received-files record that cannot be read refuses files outside the project, as for a local render.
  writeFileSync(join(project, ".hyperframes", "received-files.json"), "{");
  const clip = (id: string, src: string, start: number) =>
    `<audio id="${id}" src="${src}" data-start="${start}" data-duration="1" data-track-index="${start + 1}"></audio>`;
  writeFileSync(
    join(project, "index.html"),
    `<html><body><div data-composition-id="main" data-duration="4">
      ${clip("absolute", outside, 0)}
      ${clip("above", "../secret.wav", 1)}
      ${clip("private", ".hyperframes/state.wav", 2)}
      ${clip("own", "audio/vo.wav", 3)}
    </div></body></html>`,
  );
  return { project, outside };
}

describe("hyperframes audio film queries", () => {
  beforeEach(() => {
    probeAudio.mockClear();
    decodeAudio.mockClear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("never opens a clip source outside the project or private in it, at any quality", async () => {
    const { project, outside } = receivedProject();
    const fetch = vi.spyOn(globalThis, "fetch");
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => void lines.push(line));
    await runCommand(audioCommand, {
      rawArgs: ["--dir", project, "--json", "--quality", "best", "--only", "bpm,describe"],
    });
    const probed = probeAudio.mock.calls.map(([path]) => String(path));
    expect(probed).toEqual([join(project, "audio", "vo.wav")]);
    expect(decodeAudio.mock.calls.map(([path]) => String(path))).not.toContain(outside);
    expect(fetch).not.toHaveBeenCalled();
    const items = JSON.parse(lines.join("\n")).items as { ref: string; error?: string }[];
    const errors = Object.fromEntries(items.map((item) => [item.ref, item.error]));
    expect(errors).toMatchObject({
      "#absolute": "file not found",
      "#above": "file not found",
      "#private": "file not found",
    });
  });

  it("still analyzes a file named on the command line, wherever it is", async () => {
    const { outside } = receivedProject();
    vi.spyOn(console, "log").mockImplementation(() => {});
    await runCommand(audioCommand, { rawArgs: [outside, "--json"] });
    expect(probeAudio.mock.calls.map(([path]) => String(path))).toEqual([outside]);
  });
});
