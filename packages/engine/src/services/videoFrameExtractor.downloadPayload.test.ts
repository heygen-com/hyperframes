import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { VideoElement } from "../types.js";
import { runFfmpeg } from "../utils/runFfmpeg.js";

// The download hands back `served.main`, with `served.beside` saved next to it.
const served = vi.hoisted(() => ({ main: "", beside: [] as string[] }));
vi.mock("../utils/urlDownloader.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/urlDownloader.js")>()),
  downloadToTemp: async (_url: string, destDir: string) => {
    for (const file of served.beside) copyFileSync(file, join(destDir, basename(file)));
    const local = join(destDir, "download.mp4");
    copyFileSync(served.main, local);
    return local;
  },
}));

const probed = vi.hoisted(() => ({
  paths: [] as string[],
  signals: [] as (AbortSignal | undefined)[],
}));
vi.mock("../utils/ffprobe.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/ffprobe.js")>();
  return {
    ...actual,
    runFfprobe: (path: string, args: string[], signal?: AbortSignal) => {
      probed.signals.push(signal);
      return actual.runFfprobe(path, args, signal);
    },
    extractMediaMetadata: (path: string) => {
      probed.paths.push(path);
      return actual.extractMediaMetadata(path);
    },
  };
});

const { extractAllVideoFrames } = await import("./videoFrameExtractor.js");

describe.skipIf(process.platform === "win32")("extractAllVideoFrames downloaded payloads", () => {
  const dir = mkdtempSync(join(tmpdir(), "hf-extract-download-payload-"));
  let renders = 0;
  let mp4 = "";
  let mov = "";
  let webm = "";
  let segment = "";
  let wideFtyp = "";
  let leadingFree = "";
  let uuidAfterFtyp = "";

  async function synth(name: string, codec: string[]): Promise<string> {
    const clip = join(dir, name);
    const made = await runFfmpeg([
      ...["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=32x16:d=1:r=30"],
      ...codec,
      clip,
    ]);
    expect(made.success, made.stderr).toBe(true);
    return clip;
  }

  function box(type: string, size: number, fill = 0): Buffer {
    const bytes = Buffer.alloc(size, fill);
    bytes.writeUInt32BE(size, 0);
    bytes.write(type, 4, "latin1");
    return bytes;
  }

  // A fragmented mp4 addresses its samples from each moof, so boxes added ahead of them shift nothing they name.
  async function fragmentedWith(name: string, h264: string[], edit: (ftyp: Buffer) => Buffer[]) {
    const fragmented = await synth(`${name}-source.mp4`, [
      ...h264,
      ...["-movflags", "frag_keyframe+empty_moov+default_base_moof"],
    ]);
    const bytes = readFileSync(fragmented);
    expect(bytes.toString("latin1", 4, 8)).toBe("ftyp");
    const ftypSize = bytes.readUInt32BE(0);
    const path = join(dir, `${name}.mp4`);
    const rest = bytes.subarray(ftypSize);
    writeFileSync(path, Buffer.concat([...edit(bytes.subarray(0, ftypSize)), rest]));
    return path;
  }

  function sixtyByteFtyp(): Buffer {
    const ftyp = box("ftyp", 60);
    ftyp.write("isom", 8, "latin1");
    ftyp.writeUInt32BE(0x200, 12);
    ftyp.write("isomiso2avc1mp41iso5iso6dashmsdhmsixcmfcmp42", 16, "latin1");
    return ftyp;
  }

  function write(name: string, text: string): string {
    const path = join(dir, name);
    writeFileSync(path, text);
    return path;
  }

  function render(main: string, beside: string[] = [], signal?: AbortSignal) {
    served.main = main;
    served.beside = beside;
    probed.paths = [];
    probed.signals = [];
    const outputDir = join(dir, `render-${++renders}`);
    mkdirSync(outputDir, { recursive: true });
    const video: VideoElement = {
      id: "clip",
      src: "https://cdn.example.com/clip.mp4",
      ...{ start: 0, end: 1, mediaStart: 0, loop: false, hasAudio: false },
    };
    return extractAllVideoFrames(
      [video],
      dir,
      { fps: 30, outputDir, collectProbeFailures: true },
      signal,
    );
  }

  function framesOf(result: Awaited<ReturnType<typeof render>>): Buffer[] {
    const extracted = result.extracted[0];
    if (!extracted) throw new Error("nothing extracted");
    return [...extracted.framePaths.values()].map((path) => readFileSync(path));
  }

  beforeAll(async () => {
    const h264 = ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"];
    mp4 = await synth("real.mp4", h264);
    mov = await synth("real.mov", h264);
    webm = await synth("real.webm", ["-c:v", "libvpx-vp9", "-deadline", "realtime"]);
    segment = await synth("segment.ts", h264);
    wideFtyp = await fragmentedWith("wide-ftyp", h264, () => [sixtyByteFtyp()]);
    leadingFree = await fragmentedWith("leading-free", h264, (ftyp) => [box("free", 60), ftyp]);
    uuidAfterFtyp = await fragmentedWith("uuid", h264, () => [
      sixtyByteFtyp(),
      box("uuid", 24, 0x5a),
    ]);
  });

  afterEach(() => vi.unstubAllEnvs());
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("refuses a downloaded manifest as not media before any probe reads it", async () => {
    const manifest = write(
      "manifest.mpd",
      '<?xml version="1.0"?>\n<MPD profiles="urn:mpeg:dash:profile:isoff-on-demand:2011">' +
        `<Period><AdaptationSet><Representation id="1"><BaseURL>${mp4}</BaseURL>` +
        "</Representation></AdaptationSet></Period></MPD>\n",
    );
    const result = await render(manifest);
    expect(result.extracted).toEqual([]);
    expect(result.errors).toEqual([
      expect.objectContaining({ videoId: "clip", kind: "invalid_media", retryable: false }),
    ]);
    expect(result.errors[0]?.error).toContain("text documents");
    expect(probed.paths).toEqual([]);
  });

  it("on a render service refuses a downloaded playlist naming a file beside it", async () => {
    vi.stubEnv("PRODUCER_RESTRICT_PAGE_NETWORK", "true");
    const playlist = write(
      "playlist.m3u8",
      `#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\n${basename(segment)}\n#EXT-X-ENDLIST\n`,
    );
    const result = await render(playlist, [segment]);
    expect(result.extracted).toEqual([]);
    expect(result.errors).toEqual([
      expect.objectContaining({ videoId: "clip", kind: "invalid_media", retryable: false }),
    ]);
    expect(probed.paths).toEqual([]);
  });

  it("on a render service the download's format check runs under the render's cancel signal", async () => {
    vi.stubEnv("PRODUCER_RESTRICT_PAGE_NETWORK", "true");
    const cancel = new AbortController();
    const result = await render(mp4, [], cancel.signal);
    expect(result.errors).toEqual([]);
    expect(probed.signals[0]).toBe(cancel.signal);
  });

  it.each([
    ["mp4", () => mp4],
    ["mov", () => mov],
    ["webm", () => webm],
    ["fragmented mp4 with a 60-byte ftyp", () => wideFtyp],
    ["fragmented mp4 opening with a 60-byte free box", () => leadingFree],
    ["fragmented mp4 with a uuid box after a 60-byte ftyp", () => uuidAfterFtyp],
  ])("extracts a real %s download the same on a render service", async (_kind, clip) => {
    const local = await render(clip());
    vi.stubEnv("PRODUCER_RESTRICT_PAGE_NETWORK", "true");
    const restricted = await render(clip());
    expect(local.errors).toEqual([]);
    expect(restricted.errors).toEqual([]);
    expect(restricted.extracted[0]?.totalFrames).toBe(30);
    expect(framesOf(restricted)).toEqual(framesOf(local));
  });
});
