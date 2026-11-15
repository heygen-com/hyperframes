import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getFfprobeBinary } from "./ffmpegBinaries.js";
import {
  assertMediaPayload,
  fingerprintElementId,
  isNotMediaPayload,
  NotMediaPayloadError,
  playlistLeavesItsFolder,
} from "./notMediaPayload.js";

function writeFixture(name: string, contents: string | Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-markup-sniff-"));
  const filePath = join(dir, name);
  writeFileSync(filePath, contents);
  return filePath;
}

function writeTree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-playlist-tree-"));
  for (const [name, contents] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), contents);
  }
  return join(dir, Object.keys(files)[0]!);
}

describe("isNotMediaPayload", () => {
  it.each([
    ["doctype", "<!DOCTYPE html>\n<html><body></body></html>"],
    ["bare html tag, uppercase", "<HTML><body>hi</body></HTML>"],
    [
      "xml prolog",
      '<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg"/>',
    ],
    // The prolog-less form is the common minified SVG shape, and the one a
    // `<!doctype|<html|<?xml` prefix allowlist misses.
    ["prolog-less svg", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>'],
    // How a media URL most often downloads as XML in production: an expired
    // signed URL or an ACL change, served as a 200 with an S3 error body.
    ["s3 error document", '<?xml version="1.0"?><Error><Code>AccessDenied</Code></Error>'],
    ["comment first", "<!-- generated -->\n<!DOCTYPE html>"],
    // Replicate answers a dead asset this way, and a gateway in front of it can
    // relay the body with a 200 — the shape a `<` -only check misses.
    ["json object error body", '{"detail": "requested file not found"}'],
    ["json array body", '[{"error": "gone"}]'],
  ])("detects %s", async (_label, contents) => {
    expect(await isNotMediaPayload(writeFixture("payload", contents))).toBe(true);
  });

  it("detects a document behind a UTF-8 BOM and leading whitespace", async () => {
    const filePath = writeFixture(
      "bom.html",
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from("\n  \t<!doctype html><html></html>"),
      ]),
    );
    expect(await isNotMediaPayload(filePath)).toBe(true);
  });

  it("detects a document behind a leading NUL run", async () => {
    const filePath = writeFixture(
      "nul.html",
      Buffer.concat([Buffer.from([0x00, 0x00, 0x00]), Buffer.from("<html>x</html>")]),
    );
    expect(await isNotMediaPayload(filePath)).toBe(true);
  });

  it.each([
    ["little-endian", [0xff, 0xfe]],
    ["big-endian", [0xfe, 0xff]],
  ])("detects UTF-16 %s markup", async (_label, bom) => {
    // UTF-16 interleaves NULs between ASCII bytes, so a utf8-decoded prefix
    // comparison sees replacement characters and misses it entirely.
    const body = Buffer.from("<html>", "utf16le");
    const bytes = _label === "little-endian" ? body : body.swap16();
    const filePath = writeFixture("utf16.html", Buffer.concat([Buffer.from(bom), bytes]));
    expect(await isNotMediaPayload(filePath)).toBe(true);
  });

  it("detects nothing when padding overruns the sniff window", async () => {
    const filePath = writeFixture("padded.html", `${" ".repeat(600)}<!doctype html>`);
    // 600 bytes of padding overruns the 512-byte sniff window, so the verdict
    // has to be "unknown" (false) rather than a misread — asserted here so the
    // window size is a deliberate, visible bound rather than an accident.
    expect(await isNotMediaPayload(filePath)).toBe(false);
  });

  it.each([
    ["mp4 / ftypmp42", [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]],
    ["matroska / webm EBML", [0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01]],
    ["ogg", [0x4f, 0x67, 0x67, 0x53, 0x00, 0x02]],
    ["riff / wav", [0x52, 0x49, 0x46, 0x46, 0x24, 0x08]],
    ["mpeg-ts", [0x47, 0x40, 0x00, 0x10]],
    ["flac", [0x66, 0x4c, 0x61, 0x43, 0x00]],
    ["mp3 / ID3", [0x49, 0x44, 0x33, 0x03, 0x00]],
    ["adts aac", [0xff, 0xf1, 0x50, 0x80]],
    ["mpeg-ps", [0x00, 0x00, 0x01, 0xba]],
  ])("does not flag a %s container", async (_label, bytes) => {
    expect(await isNotMediaPayload(writeFixture("clip.bin", Buffer.from(bytes)))).toBe(false);
  });

  it.each([
    ["<", 0x3c, "ftyp"],
    ["#", 0x23, "ftyp"],
    ["{", 0x7b, "styp"],
    ["[", 0x5b, "moof"],
    ["space", 0x20, "ftyp"],
    ["tab", 0x09, "free"],
    ["newline", 0x0a, "sidx"],
  ])("does not flag an mp4 box whose size byte reads as %s", async (_label, size, type) => {
    const box = Buffer.concat([Buffer.from([0, 0, 0, size]), Buffer.from(`${type}isom`)]);
    expect(await isNotMediaPayload(writeFixture("clip.mp4", box))).toBe(false);
  });

  it.each([
    ["to the end of the file", 0],
    ["with a 64-bit size", 1],
  ])("does not flag an mp4 box sized %s", async (_label, size) => {
    const box = Buffer.concat([Buffer.from([0, 0, 0, size]), Buffer.from("mdat<html>")]);
    expect(await isNotMediaPayload(writeFixture("clip.mp4", box))).toBe(false);
  });

  it("still detects a document shaped like a box header with no media box type", async () => {
    const xml = Buffer.concat([Buffer.from([0, 0, 0]), Buffer.from('<?xml version="1.0"?><MPD/>')]);
    expect(await isNotMediaPayload(writeFixture("manifest.mp4", xml))).toBe(true);
  });

  it("does not flag a container that merely contains a document byte further in", async () => {
    const filePath = writeFixture(
      "not-html.bin",
      Buffer.concat([Buffer.from([0x00, 0x00, 0x01, 0xba]), Buffer.from("<html later on")]),
    );
    expect(await isNotMediaPayload(filePath)).toBe(false);
  });

  it("does not flag an empty file", async () => {
    expect(await isNotMediaPayload(writeFixture("empty.bin", ""))).toBe(false);
  });

  it("reports not-a-document instead of throwing when the path is a directory", async () => {
    // `existsSync` passes for a directory, so callers reach the sniff with one.
    // The read fails EISDIR; classifying rather than propagating keeps the real
    // probe's own error as the one the caller sees.
    const dir = mkdtempSync(join(tmpdir(), "hf-markup-sniff-dir-"));
    mkdirSync(join(dir, "assets"));
    expect(await isNotMediaPayload(join(dir, "assets"))).toBe(false);
  });

  it("reports not-a-document instead of throwing when the file is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-markup-sniff-gone-"));
    expect(await isNotMediaPayload(join(dir, "evicted.mp4"))).toBe(false);
  });
});

describe("assertMediaPayload", () => {
  it("throws NotMediaPayloadError carrying routing metadata and a hashed element key", async () => {
    const filePath = writeFixture("nested.html", "<!DOCTYPE html><html></html>");

    let caught: unknown;
    try {
      await assertMediaPayload(filePath, "aroll-scene-3");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(NotMediaPayloadError);
    const error = caught as NotMediaPayloadError;
    expect(error.code).toBe("NOT_MEDIA_PAYLOAD");
    expect(error.owner).toBe("user");
    expect(error.retryable).toBe(false);
    expect(error.elementFingerprints).toEqual([fingerprintElementId("aroll-scene-3")]);
    expect(error.message).toContain(fingerprintElementId("aroll-scene-3"));
  });

  it("names both possible causes and leaks neither the src nor the payload bytes", async () => {
    // `error.message` is forwarded to API clients over SSE/JSON, so a
    // per-tenant CDN path or a token in the payload's first bytes must not
    // reach it — and an on-call engineer must not be pointed at the authoring
    // bug when a 403 error page is the actual cause.
    const filePath = writeFixture(
      "interstitial.html",
      '<!DOCTYPE html><html data-request-token="tok_9fA3xQ7pLz">',
    );

    const error = await assertMediaPayload(
      filePath,
      "https://cdn.example.com/tenants/acme-corp/projects/secret-q4/streamed-preview.html",
    ).catch((caught: unknown) => caught as NotMediaPayloadError);

    expect(error.message).not.toContain("acme-corp");
    expect(error.message).not.toContain("secret-q4");
    expect(error.message).not.toContain("cdn.example.com");
    expect(error.message).not.toContain("tok_9fA3xQ7pLz");
    expect(error.message).toContain("unresolved");
    expect(error.message).toContain("success status");
  });

  it("resolves for a real container", async () => {
    const filePath = writeFixture("clip.mp4", Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74]));
    await expect(assertMediaPayload(filePath, "v1")).resolves.toBeUndefined();
  });

  it("caps the fingerprint list so the message stays bounded", async () => {
    const error = new NotMediaPayloadError(
      Array.from({ length: 12 }, (_unused, index) => fingerprintElementId(`el-${index}`)),
    );
    expect(error.message).toContain("+4");
    expect(error.message.length).toBeLessThan(500);
  });
});

describe("playlistLeavesItsFolder", () => {
  const hls = (...lines: string[]) =>
    ["#EXTM3U", "#EXT-X-TARGETDURATION:1", ...lines, "#EXT-X-ENDLIST"].join("\n");
  const concat = (entry: string) => `ffconcat version 1.0\nfile ${entry}\n`;

  it.each([
    ["an absolute segment", hls("#EXTINF:1,", "/var/renders/other/out.mp4")],
    ["a segment above its folder", hls("#EXTINF:1,", "../other/out.mp4")],
    ["an encoded escape", hls("#EXTINF:1,", "%2e%2e/other/out.mp4")],
    ["a file: segment", hls("#EXTINF:1,", "file:///var/renders/other/out.ts")],
    [
      "a key outside its folder",
      hls('#EXT-X-KEY:METHOD=AES-128,URI="/etc/key.bin"', "#EXTINF:1,", "seg.ts"),
    ],
    ["a Windows drive path", hls("#EXTINF:1,", "C:\\renders\\out.mp4")],
    ["an absolute concat entry", concat("'/var/renders/other/out.mp4'")],
    ["a concat entry above its folder", concat("../other/out.mp4")],
    ["a list too long to read whole", hls("#EXTINF:1,\nseg.ts\n".repeat(700_000))],
  ])("refuses %s", async (_name, contents) => {
    const file = writeFixture("clip.m3u8", contents);
    expect(await playlistLeavesItsFolder(file)).toBe(true);
    expect(await isNotMediaPayload(file)).toBe(true);
  });

  it("refuses a list whose nested list names a file outside the top folder", async () => {
    const master = writeTree({
      "master.m3u8": "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nsub/inner.m3u8\n",
      "sub/inner.m3u8": hls("#EXTINF:1,", "/var/renders/other/out.mp4"),
    });
    expect(await playlistLeavesItsFolder(master)).toBe(true);
  });

  it("refuses a nested list that steps above the top folder from its own", async () => {
    const master = writeTree({
      "master.m3u8": "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nsub/inner.m3u8\n",
      "sub/inner.m3u8": hls("#EXTINF:1,", "../../other/out.mp4"),
    });
    expect(await playlistLeavesItsFolder(master)).toBe(true);
  });

  it("refuses lists nested deeper than it reads", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 12; i++)
      files[`l${i}.m3u8`] = `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nl${i + 1}.m3u8\n`;
    files["l12.m3u8"] = hls("#EXTINF:1,", "seg.ts");
    expect(await playlistLeavesItsFolder(writeTree(files))).toBe(true);
  });

  it("keeps nested lists that stay in the top folder, cycles included", async () => {
    const master = writeTree({
      "master.m3u8": "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nsub/inner.m3u8\n",
      "sub/inner.m3u8": hls("#EXTINF:1,", "../seg.ts", "#EXTINF:1,", "../master.m3u8"),
      "seg.ts": "segment",
    });
    expect(await playlistLeavesItsFolder(master)).toBe(false);
  });

  it.each([
    ["segments beside it", hls("#EXTINF:1,", "seg0.ts", "#EXTINF:1,", "parts/seg1.ts")],
    ["https segments", hls("#EXTINF:1,", "https://cdn.example.com/seg0.ts")],
    ["a concat entry beside it", concat("'part 1.mp4'")],
    ["a media file", Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70])],
  ])("keeps %s", async (_name, contents) => {
    expect(await playlistLeavesItsFolder(writeFixture("clip.m3u8", contents))).toBe(false);
  });
});

describe("playlistLeavesItsFolder reads a list as ffprobe does", () => {
  const FFPROBE_8 = /^ffprobe version n?8\./.test(
    spawnSync(getFfprobeBinary(), ["-version"], { encoding: "utf-8" }).stdout ?? "",
  );
  const head = "#EXTM3U\n#EXT-X-TARGETDURATION:1\n";
  const tail = "#EXTINF:1,\nseg.ts\n#EXT-X-ENDLIST\n";
  const outside = "../outside/secret.mp4";
  // Cut at ffmpeg's 4095-byte line limit this names the outside file; whole, it walks back in.
  const cutLine = "./".repeat((4095 - outside.length) / 2) + outside + "/../../proj/seg.ts";
  // Each 0xFF is one byte to ffmpeg, so the cut lands after the outside name, not inside it.
  const tagStart = Buffer.concat([
    Buffer.from('#EXT-X-MAP:X="'),
    Buffer.alloc(40, 0xff),
    Buffer.from('",URI="'),
  ]);
  const tagPad = 4095 - tagStart.length - outside.length;
  const notUtf8Line = Buffer.concat([
    tagStart,
    Buffer.from(
      "./".repeat(Math.floor(tagPad / 2)) +
        (tagPad % 2 ? "/" : "") +
        outside +
        '/../../proj/seg.ts"',
    ),
  ]);

  it.each([
    ["a segment after a bare carriage return", `${head}#EXTINF:1,\r${outside}\n#EXT-X-ENDLIST\n`],
    ["a segment after a NUL", `${head}#EXTINF:1,\0${outside}\n#EXT-X-ENDLIST\n`],
    ["an unquoted map URI", `${head}#EXT-X-MAP:URI=${outside}\n${tail}`],
    ["a backslash-escaped map URI", `${head}#EXT-X-MAP:URI=".\\./outside/secret.mp4"\n${tail}`],
    [
      "an unquoted rendition URI",
      `#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=a,NAME=a,URI=${outside}\n` +
        '#EXT-X-STREAM-INF:BANDWIDTH=1,AUDIO="a"\nv.m3u8\n',
    ],
    [
      "a list behind an ID3 tag",
      Buffer.concat([
        Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]),
        Buffer.from(`${head}#EXTINF:1,\n${outside}\n#EXT-X-ENDLIST\n`),
      ]),
    ],
    ["a segment line longer than ffmpeg reads", `${head}#EXTINF:1,\n${cutLine}\n#EXT-X-ENDLIST\n`],
    [
      "a long tag line with bytes that are not UTF-8",
      Buffer.concat([
        Buffer.from(head),
        notUtf8Line,
        Buffer.from("\n#EXTINF:1,\nseg.ts\n#EXT-X-ENDLIST\n"),
      ]),
    ],
  ])("refuses %s", async (_name, contents) => {
    const root = mkdtempSync(join(tmpdir(), "hf-playlist-ffprobe-"));
    mkdirSync(join(root, "proj"));
    mkdirSync(join(root, "outside"));
    writeFileSync(join(root, "outside", "secret.mp4"), "outside media");
    writeFileSync(join(root, "proj", "v.m3u8"), head + tail);
    writeFileSync(join(root, "proj", "clip.m3u8"), contents);

    expect(await playlistLeavesItsFolder(join(root, "proj", "clip.m3u8"))).toBe(true);
    if (!FFPROBE_8) return;
    const probe = spawnSync(
      getFfprobeBinary(),
      ["-loglevel", "debug", "-show_format", "--", "clip.m3u8"],
      {
        cwd: join(root, "proj"),
        encoding: "utf-8",
      },
    );
    expect(probe.stderr).toMatch(/outside\/secret\.mp4' for reading/);
  });

  it("refuses a nested name it cannot read, and keeps one that does not exist", async () => {
    const list = (entry: string) => `${head}#EXTINF:1,\n${entry}\n#EXT-X-ENDLIST\n`;
    const unreadable = writeTree({ "clip.m3u8": list("sub"), "sub/seg.ts": "segment" });
    expect(await playlistLeavesItsFolder(unreadable)).toBe(true);
    const missing = writeTree({ "clip.m3u8": list("gone.ts") });
    expect(await playlistLeavesItsFolder(missing)).toBe(false);
    const tooLong = writeTree({ "clip.m3u8": list("a".repeat(5000)) });
    expect(await playlistLeavesItsFolder(tooLong)).toBe(false);
  });

  it.skipIf(process.platform !== "linux")(
    "reads a nested list whose name is not UTF-8 by its bytes",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "hf-playlist-bytes-"));
      const name = Buffer.concat([Buffer.from("in"), Buffer.from([0xff]), Buffer.from(".m3u8")]);
      writeFileSync(Buffer.from(`${root}/${name.toString("latin1")}`, "latin1"), list(outside));
      const top = Buffer.concat([
        Buffer.from("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n"),
        name,
        Buffer.from("\n"),
      ]);
      writeFileSync(join(root, "clip.m3u8"), top);
      expect(await playlistLeavesItsFolder(join(root, "clip.m3u8"))).toBe(true);

      function list(entry: string): string {
        return `${head}#EXTINF:1,\n${entry}\n#EXT-X-ENDLIST\n`;
      }
    },
  );

  it("keeps a list with the same tags naming files beside it", async () => {
    const list = `${head}#EXT-X-MAP:URI=init.mp4\r#EXT-X-KEY:METHOD=AES-128,URI="k\\ey.bin"\r${tail}`;
    expect(await playlistLeavesItsFolder(writeFixture("clip.m3u8", list))).toBe(false);
  });

  it("refuses a file behind more ID3 tags than it skips", async () => {
    const tag = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]);
    const file = writeFixture(
      "clip.m3u8",
      Buffer.concat([...Array(17).fill(tag), Buffer.from(head)]),
    );
    expect(await playlistLeavesItsFolder(file)).toBe(true);
  });
});

describe.skipIf(process.platform === "win32")("a FIFO with no writer", () => {
  function fifoBeside(list?: string): string {
    const dir = mkdtempSync(join(tmpdir(), "hf-playlist-fifo-"));
    execFileSync("mkfifo", [join(dir, "pipe.mp4")]);
    if (list === undefined) return join(dir, "pipe.mp4");
    writeFileSync(join(dir, "clip.m3u8"), list);
    return join(dir, "clip.m3u8");
  }

  it("is refused as media without waiting for a writer", async () => {
    expect(await isNotMediaPayload(fifoBeside())).toBe(true);
  });

  it("is refused when a list names it, without waiting for a writer", async () => {
    const list = fifoBeside("#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\npipe.mp4\n");
    expect(await playlistLeavesItsFolder(list)).toBe(true);
  });
});
