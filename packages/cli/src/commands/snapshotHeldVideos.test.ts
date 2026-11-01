import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() => vi.fn());
vi.mock("../utils/cancellableProcess.js", () => ({ runCancellableProcess: run }));

import {
  localVideoRenderIds,
  probeSourceDuration,
  projectLocalFile,
} from "./snapshotHeldVideos.js";

describe("localVideoRenderIds", () => {
  it("lists the videos that play a project file, by render id when stamped", () => {
    const html = `<body>
      <video id="a" src="clips/a.mp4"></video>
      <video id="b" data-hf-render-id="b-stamped"><source src="./b.mp4" /></video>
      <video id="a" src="clips/a.mp4"></video>
    </body>`;

    expect(localVideoRenderIds(html)).toEqual(["a", "b-stamped"]);
  });

  it.each([
    ["a remote clip", `<video id="r" src="https://cdn.example.com/r.mp4"></video>`],
    ["a protocol-relative clip", `<video id="r" src="//cdn.example.com/r.mp4"></video>`],
    ["an inline clip", `<video id="r" src="data:video/mp4;base64,AAAA"></video>`],
    ["a blob clip", `<video id="r" src="blob:https://x/1"></video>`],
    ["a video with no source", `<video id="r"></video>`],
    ["a video with no id", `<video src="clip.mp4"></video>`],
  ])("leaves out %s", (_label, html) => {
    expect(localVideoRenderIds(`<body>${html}</body>`)).toEqual([]);
  });
});

describe("projectLocalFile", () => {
  const dir = mkdtempSync(join(tmpdir(), "hf-held-videos-"));
  mkdirSync(join(dir, "clips"));
  writeFileSync(join(dir, "clips", "a b.mp4"), "x");
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("names the file a page URL points at, decoding the path", () => {
    expect(projectLocalFile(dir, "http://127.0.0.1:3000/clips/a%20b.mp4")).toBe(
      join(dir, "clips", "a b.mp4"),
    );
  });

  it.each([
    ["a file that is not there", "http://127.0.0.1:3000/clips/gone.mp4"],
    ["a path above the project", "http://127.0.0.1:3000/%2e%2e/%2e%2e/etc/passwd"],
    ["something that is not a URL", "not a url"],
  ])("gives null for %s", (_label, src) => {
    expect(projectLocalFile(dir, src)).toBeNull();
  });
});

describe("probeSourceDuration", () => {
  beforeEach(() => {
    run.mockReset();
  });

  it("reads the container duration and asks FFprobe once per file", async () => {
    run.mockResolvedValue({ stdout: JSON.stringify({ format: { duration: "12.480000" } }) });
    const cache = new Map<string, Promise<number>>();

    const both = await Promise.all([
      probeSourceDuration("/p/a.mp4", cache, "ffprobe"),
      probeSourceDuration("/p/a.mp4", cache, "ffprobe"),
    ]);

    expect(both).toEqual([12.48, 12.48]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "FFprobe fails",
      () =>
        run.mockImplementation(async () => {
          throw new Error("boom");
        }),
      "ffprobe",
    ],
    ["it prints no duration", () => run.mockResolvedValue({ stdout: "{}" }), "ffprobe"],
    ["FFprobe is not installed", () => {}, null],
  ])("gives 0 when %s", async (_label, arrange, ffprobe) => {
    arrange();

    await expect(
      probeSourceDuration("/p/a.mp4", new Map(), ffprobe as string | null as string),
    ).resolves.toBe(0);
  });
});
