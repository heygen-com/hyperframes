import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() => vi.fn());
vi.mock("../utils/cancellableProcess.js", () => ({ runCancellableProcess: run }));

import {
  heldVideoHints,
  localVideoRenderIds,
  localVideos,
  probeHeldVideo,
  projectLocalFile,
  projectVideoFile,
  type HeldVideoProbe,
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

  it("names the file a project-relative src points at", () => {
    expect(projectLocalFile(dir, "clips/a%20b.mp4")).toBe(join(dir, "clips", "a b.mp4"));
  });

  it.each([
    ["a file that is not there", "http://127.0.0.1:3000/clips/gone.mp4"],
    ["a path above the project", "http://127.0.0.1:3000/%2e%2e/%2e%2e/etc/passwd"],
    ["something that is not a URL", "not a url"],
  ])("gives null for %s", (_label, src) => {
    expect(projectLocalFile(dir, src)).toBeNull();
  });

  it.each([".hyperframes/handoff.mp4", ".git/clip.mp4", ".env", "keys/id_ed25519"])(
    "gives null for the private project file %s",
    (rel) => {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), "x");
      expect(projectLocalFile(dir, `http://127.0.0.1:3000/${rel}`)).toBeNull();
    },
  );

  it("gives null for a link whose target is a private project file", () => {
    mkdirSync(join(dir, ".hyperframes"), { recursive: true });
    writeFileSync(join(dir, ".hyperframes", "record.mp4"), "x");
    symlinkSync(join(dir, ".hyperframes", "record.mp4"), join(dir, "clips", "link.mp4"));
    expect(projectLocalFile(dir, "clips/link.mp4")).toBeNull();
  });

  it("names a file in Studio's own prepared-assets folder", () => {
    const rel = ".hyperframes/prepared-assets/clip.mp4";
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), "x");
    expect(projectLocalFile(dir, rel)).toBe(join(dir, rel));
  });
});

const probeJson = (stream: object, duration = "12.480000") =>
  JSON.stringify({ format: { duration }, streams: [stream] });

describe("probeHeldVideo", () => {
  beforeEach(() => {
    run.mockReset();
  });

  it("reads duration and size and asks FFprobe once per file", async () => {
    run.mockResolvedValue({ stdout: probeJson({ width: 1280, height: 720 }) });
    const cache = new Map<string, Promise<HeldVideoProbe>>();

    const both = await Promise.all([
      probeHeldVideo("/p/a.mp4", cache, "ffprobe"),
      probeHeldVideo("/p/a.mp4", cache, "ffprobe"),
    ]);

    expect(both).toEqual([
      { duration: 12.48, width: 1280, height: 720 },
      { duration: 12.48, width: 1280, height: 720 },
    ]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a rotation side-data entry", { side_data_list: [{ rotation: -90 }] }],
    ["a rotate tag", { tags: { rotate: "90" } }],
  ])("swaps the size of footage turned by %s", async (_label, turned) => {
    run.mockResolvedValue({ stdout: probeJson({ width: 1920, height: 1080, ...turned }) });

    await expect(probeHeldVideo("/p/a.mp4", new Map(), "ffprobe")).resolves.toEqual({
      duration: 12.48,
      width: 1080,
      height: 1920,
    });
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
    ["it prints nothing usable", () => run.mockResolvedValue({ stdout: "{}" }), "ffprobe"],
    ["FFprobe is not installed", () => {}, null],
  ])("gives zeros when %s", async (_label, arrange, ffprobe) => {
    arrange();

    await expect(
      probeHeldVideo("/p/a.mp4", new Map(), ffprobe as string | null as string),
    ).resolves.toEqual({ duration: 0, width: 0, height: 0 });
  });
});

describe("heldVideoHints", () => {
  const dir = mkdtempSync(join(tmpdir(), "hf-held-hints-"));
  writeFileSync(join(dir, "wide.mp4"), "x");
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  beforeEach(() => {
    run.mockReset();
  });

  it("gives a held height:auto clip its intrinsic size, as render does, and skips what has none", async () => {
    run.mockResolvedValue({ stdout: probeJson({ width: 1280, height: 720 }) });
    const videos = localVideos(
      `<body><video id="wide" src="wide.mp4" style="width:100%;height:auto"></video>
      <video id="gone" src="gone.mp4"></video></body>`,
    );

    await expect(heldVideoHints(dir, videos, new Map(), "ffprobe")).resolves.toEqual([
      { id: "wide", width: 1280, height: 720 },
    ]);
  });

  it("never probes a private project file", async () => {
    mkdirSync(join(dir, ".hyperframes"), { recursive: true });
    writeFileSync(join(dir, ".hyperframes", "record.mp4"), "x");
    run.mockResolvedValue({ stdout: probeJson({ width: 1280, height: 720 }) });
    const videos = [{ id: "kept", src: ".hyperframes/record.mp4" }];

    await expect(heldVideoHints(dir, videos, new Map(), "ffprobe")).resolves.toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("projectVideoFile", () => {
  const root = mkdtempSync(join(tmpdir(), "hf-held-playlist-"));
  const dir = join(root, "project");
  mkdirSync(join(root, "outside"));
  mkdirSync(dir);
  writeFileSync(join(root, "outside", "secret.mp4"), "outside media");
  writeFileSync(join(dir, "clip.mp4"), Buffer.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70]));
  const list = (entry: string) =>
    `#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\n${entry}\n#EXT-X-ENDLIST\n`;
  writeFileSync(join(dir, "escape.m3u8"), list("../outside/secret.mp4"));
  writeFileSync(join(dir, "escape.mp4"), list(join(root, "outside", "secret.mp4")));
  writeFileSync(join(dir, "stream.m3u8"), list("seg0.ts"));
  writeFileSync(join(dir, "seg0.ts"), "segment");
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  beforeEach(() => {
    run.mockReset();
  });

  it.each([
    ["a playlist naming a file above the project", "escape.m3u8"],
    ["a playlist behind a media extension", "escape.mp4"],
  ])("refuses %s, and FFprobe never reads it", async (_label, src) => {
    await expect(projectVideoFile(dir, src)).resolves.toEqual({
      file: join(dir, src),
      refused: true,
    });
    await expect(probeHeldVideo(join(dir, src), new Map(), "ffprobe")).resolves.toEqual({
      duration: 0,
      width: 0,
      height: 0,
    });
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    ["a media file", "clip.mp4"],
    ["a playlist of segments beside it", "stream.m3u8"],
  ])("keeps %s", async (_label, src) => {
    await expect(projectVideoFile(dir, src)).resolves.toEqual({
      file: join(dir, src),
      refused: false,
    });
  });

  it("gives null for a src outside the project", async () => {
    await expect(projectVideoFile(dir, "../outside/secret.mp4")).resolves.toBeNull();
  });
});

describe.skipIf(process.platform === "win32")(
  "a project video that is a FIFO with no writer",
  () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-held-fifo-"));
    execFileSync("mkfifo", [join(dir, "pipe.mp4")]);
    afterAll(() => rmSync(dir, { recursive: true, force: true }));
    beforeEach(() => {
      run.mockReset();
    });

    it("is refused for frame extraction without waiting for a writer", async () => {
      await expect(projectVideoFile(dir, "pipe.mp4")).resolves.toEqual({
        file: join(dir, "pipe.mp4"),
        refused: true,
      });
    });

    it("gets no held-video hint, and FFprobe never reads it", async () => {
      const videos = localVideos('<body><video id="pipe" src="pipe.mp4"></video></body>');
      await expect(heldVideoHints(dir, videos, new Map(), "ffprobe")).resolves.toEqual([]);
      expect(run).not.toHaveBeenCalled();
    });
  },
);
