import { publicRequest } from "@hyperframes/engine/public-network";
vi.mock("@hyperframes/engine/public-network", () => ({ publicRequest: vi.fn() }));
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { consumeCommandResult } from "../../utils/commandResult.js";
import {
  MAX_VIDEO_BYTES,
  VIDEO_CONTENT_TYPE_RE,
  findFilenameCollision,
  pickManifestEntry,
  runVideoMode,
  type ManifestEntry,
} from "./video.js";
import { videoStem } from "../../capture/capturedVideo.js";

const ENTRY = (index: number, partial: Partial<ManifestEntry> = {}): ManifestEntry => ({
  index,
  url: `https://cdn.example.com/video-${index}.mp4`,
  filename: `video-${index}.mp4`,
  width: 1920,
  height: 1080,
  heading: "",
  caption: "",
  ariaLabel: "",
  preview: `assets/videos/previews/video-${index}-preview.png`,
  ...partial,
});

describe("videoStem", () => {
  it("decodes percent-encoded chars", () => {
    expect(videoStem("Frame-2147227325%20(1).mp4")).toBe("Frame-2147227325_1_");
  });

  it("strips characters outside [A-Za-z0-9_-]", () => {
    expect(videoStem("video with spaces & symbols!.mp4")).toBe("video_with_spaces_symbols_");
  });

  it("drops the page's extension and keeps version markers", () => {
    expect(videoStem("hero.mp4")).toBe("hero");
    expect(videoStem("hero-v2.webm")).toBe("hero-v2");
    expect(videoStem("CLAUDE.md")).toBe("CLAUDE");
    expect(videoStem("clip.v2.mp4")).toBe("clip_v2");
  });

  it("never names a dotfile or a folder", () => {
    expect(videoStem(".cursorrules")).toBe("_cursorrules");
    expect(videoStem("../notes/AGENTS.md")).toBe("AGENTS");
    expect(videoStem("")).toBe("video");
  });

  it("falls back when decodeURIComponent throws on a malformed sequence", () => {
    // `%E0%A4%A` is a truncated UTF-8 multibyte sequence and throws URIError.
    // We should keep the raw input rather than crashing.
    expect(videoStem("Bad%E0%A4%A.mp4")).toBe("Bad_E0_A4_A");
  });

  it("collapses runs of disallowed characters into a single underscore", () => {
    expect(videoStem("a   b___c")).toBe("a_b___c");
  });
});

describe("VIDEO_CONTENT_TYPE_RE", () => {
  it("matches common video content-types", () => {
    expect(VIDEO_CONTENT_TYPE_RE.test("video/mp4")).toBe(true);
    expect(VIDEO_CONTENT_TYPE_RE.test("video/webm")).toBe(true);
    expect(VIDEO_CONTENT_TYPE_RE.test("video/quicktime")).toBe(true);
  });

  it("matches application/* containers that CDNs commonly use", () => {
    expect(VIDEO_CONTENT_TYPE_RE.test("application/mp4")).toBe(true);
    expect(VIDEO_CONTENT_TYPE_RE.test("application/octet-stream")).toBe(true);
    expect(VIDEO_CONTENT_TYPE_RE.test("application/x-mpegURL")).toBe(true);
  });

  it("rejects HTML / JSON error pages that pretend to be videos", () => {
    expect(VIDEO_CONTENT_TYPE_RE.test("text/html")).toBe(false);
    expect(VIDEO_CONTENT_TYPE_RE.test("application/json")).toBe(false);
    expect(VIDEO_CONTENT_TYPE_RE.test("image/png")).toBe(false);
  });
});

describe("MAX_VIDEO_BYTES", () => {
  it("is 250 MB", () => {
    expect(MAX_VIDEO_BYTES).toBe(250 * 1024 * 1024);
  });
});

describe("pickManifestEntry", () => {
  it("returns no-selector when neither --index nor --url is given", () => {
    const r = pickManifestEntry([ENTRY(0)], {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("no-selector");
  });

  it("looks up by the entry's `index` field, NOT array offset (manifest gaps)", () => {
    const manifest = [ENTRY(0), ENTRY(2), ENTRY(3)]; // index 1 missing
    const r = pickManifestEntry(manifest, { index: 3 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.entry.url).toBe("https://cdn.example.com/video-3.mp4");
  });

  it("rejects a request for an index that's not in the manifest", () => {
    const manifest = [ENTRY(0), ENTRY(2)]; // index 1 missing
    const r = pickManifestEntry(manifest, { index: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("no-match-index");
      expect(r.message).toContain("index=1");
      expect(r.message).toContain("available: 0, 2");
    }
  });

  it("rejects a negative or non-integer index up front", () => {
    expect(pickManifestEntry([ENTRY(0)], { index: -1 }).ok).toBe(false);
    expect(pickManifestEntry([ENTRY(0)], { index: 1.5 }).ok).toBe(false);
    expect(pickManifestEntry([ENTRY(0)], { index: "abc" }).ok).toBe(false);
  });

  it("accepts numeric-string indices (citty parses positional args as strings)", () => {
    const r = pickManifestEntry([ENTRY(0), ENTRY(1)], { index: "1" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.entry.index).toBe(1);
  });

  it("looks up by exact URL match", () => {
    const manifest = [ENTRY(0), ENTRY(1)];
    const r = pickManifestEntry(manifest, { url: "https://cdn.example.com/video-1.mp4" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.entry.index).toBe(1);
  });

  it("rejects a URL that doesn't appear in the manifest", () => {
    const manifest = [ENTRY(0)];
    const r = pickManifestEntry(manifest, { url: "https://other.com/missing.mp4" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("no-match-url");
      expect(r.message).toContain("missing.mp4");
    }
  });

  it("when both --index and --url are passed, --index wins (CLI's declared priority)", () => {
    const manifest = [ENTRY(0), ENTRY(1)];
    const r = pickManifestEntry(manifest, {
      index: 1,
      url: "https://cdn.example.com/video-0.mp4",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.entry.index).toBe(1);
  });
});

describe("findFilenameCollision", () => {
  it("returns [] when no other manifest entry produces the same videoStem", () => {
    const manifest = [ENTRY(0), ENTRY(1), ENTRY(2)];
    expect(findFilenameCollision(manifest, manifest[1]!)).toEqual([]);
  });

  it("flags collisions when two URL forms collapse to the same videoStem", () => {
    // "hero%20clip.mp4" and "hero clip.mp4" both → "hero_clip"
    const manifest = [
      ENTRY(0, { url: "https://cdn.example.com/hero%20clip.mp4", filename: "hero%20clip.mp4" }),
      ENTRY(1, { url: "https://cdn.example.com/hero clip.mp4", filename: "hero clip.mp4" }),
    ];
    const collisions = findFilenameCollision(manifest, manifest[0]!);
    expect(collisions).toHaveLength(1);
    expect(collisions[0]?.index).toBe(1);
  });

  it("does not return the selected entry itself as a collision", () => {
    const manifest = [ENTRY(0), ENTRY(1)];
    const collisions = findFilenameCollision(manifest, manifest[0]!);
    expect(collisions.every((c) => c.index !== 0)).toBe(true);
  });
});

describe("runVideoMode", () => {
  // Creating symlinks needs elevated rights on Windows.
  it.skipIf(process.platform === "win32").each([
    { layout: "capture output", manifestDir: "extracted", planted: "assets" },
    { layout: "W2H project", manifestDir: "capture/extracted", planted: "capture" },
  ])(
    "refuses to download through a planted $planted symlink in a $layout (#4304)",
    async ({ manifestDir, planted }) => {
      const root = mkdtempSync(join(tmpdir(), "hf-video-mode-"));
      onTestFinished(() => rmSync(root, { recursive: true, force: true }));
      const projectDir = join(root, "project");
      const outside = join(root, "outside");
      mkdirSync(projectDir);
      mkdirSync(outside);
      symlinkSync(outside, join(projectDir, planted));
      mkdirSync(join(projectDir, manifestDir), { recursive: true });
      writeFileSync(
        join(projectDir, manifestDir, "video-manifest.json"),
        JSON.stringify([ENTRY(0)]),
      );
      const fetchMock = vi.fn(async () => {
        throw new Error("no network in tests");
      });
      vi.stubGlobal("fetch", fetchMock);
      vi.spyOn(console, "log").mockImplementation(() => {});
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      onTestFinished(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
      });

      await runVideoMode({ project: projectDir, index: "0" });

      expect(consumeCommandResult().exitCode).toBe(1);
      expect(String(error.mock.calls[0]?.[0])).toContain("resolves outside the capture directory");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(existsSync(join(outside, planted === "assets" ? "videos" : "assets"))).toBe(false);
    },
  );
});

describe("runVideoMode --list", () => {
  it("prints manifest values with control characters escaped", async () => {
    // Built rather than written: a literal control character in the source is a lint error.
    const esc = String.fromCharCode(27);
    const projectDir = mkdtempSync(join(tmpdir(), "hf-video-list-"));
    onTestFinished(() => rmSync(projectDir, { recursive: true, force: true }));
    mkdirSync(join(projectDir, "extracted"));
    writeFileSync(
      join(projectDir, "extracted", "video-manifest.json"),
      JSON.stringify([
        ENTRY(0, {
          heading: `Launch${esc}[2J`,
          url: `https://cdn.example.com/a${esc}]8;;https://x.test${String.fromCharCode(7)}.mp4`,
        }),
      ]),
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    onTestFinished(() => log.mockRestore());

    await runVideoMode({ project: projectDir, list: true });

    const printed = log.mock.calls
      .map((call) => call.join(" "))
      .join("\n")
      .replace(new RegExp(`${esc}\\[[0-9;]*m`, "g"), "");
    expect(printed).not.toContain(esc);
    expect(printed).toContain('heading: "Launch\\x1b[2J"');
    expect(printed).toContain("a\\x1b]8;;https://x.test\\x07.mp4");
  });
});

describe("runVideoMode: the project folder in what it prints", () => {
  const bell = String.fromCharCode(7);

  it("shows control characters in a folder with no manifest as text", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => error.mockRestore());

    await runVideoMode({ project: join(tmpdir(), `hf-missing${bell}dir`), list: true });

    expect(consumeCommandResult().exitCode).toBe(1);
    const printed = error.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(printed).not.toContain(bell);
    expect(printed.match(/hf-missing\\x07dir/g)).toHaveLength(2);
  });

  // Windows does not allow a control character in a folder name.
  it.skipIf(process.platform === "win32")(
    "shows control characters in the manifest path of a listing as text",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "hf-video-path-"));
      onTestFinished(() => rmSync(root, { recursive: true, force: true }));
      const projectDir = join(root, `site${bell}one`);
      mkdirSync(join(projectDir, "extracted"), { recursive: true });
      writeFileSync(
        join(projectDir, "extracted", "video-manifest.json"),
        JSON.stringify([ENTRY(0)]),
      );
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      onTestFinished(() => log.mockRestore());

      await runVideoMode({ project: projectDir, list: true });

      const printed = log.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(printed).not.toContain(bell);
      expect(printed).toContain("1 video entry in ");
      expect(printed).toContain("site\\x07one");
    },
  );
});

describe("runVideoMode: the file it writes", () => {
  const MP4 = Buffer.concat([
    Buffer.from([0, 0, 0, 0x18]),
    Buffer.from("ftypisom"),
    Buffer.alloc(4096),
  ]);
  function projectWith(entry: ManifestEntry): string {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-video-name-"));
    onTestFinished(() => rmSync(projectDir, { recursive: true, force: true }));
    mkdirSync(join(projectDir, "extracted"));
    writeFileSync(join(projectDir, "extracted", "video-manifest.json"), JSON.stringify([entry]));
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    return projectDir;
  }
  const answer = (body: Buffer) =>
    vi
      .mocked(publicRequest)
      .mockImplementation(
        vi.fn(
          async () =>
            new Response(new Uint8Array(body), { headers: { "content-type": "video/mp4" } }),
        ),
      );

  // fails without the fix: the manifest's name was written as given, so an entry naming CLAUDE.md wrote that file.
  it("takes the entry name's stem and the extension the video's own bytes are", async () => {
    const projectDir = projectWith(ENTRY(0, { filename: "CLAUDE.md" }));
    answer(MP4);
    await runVideoMode({ project: projectDir, index: "0" });
    expect(consumeCommandResult().exitCode).not.toBe(1);
    expect(readdirSync(join(projectDir, "assets", "videos"))).toEqual(["CLAUDE.mp4"]);
  });

  // fails without the fix: a video Content-Type was enough, so any body was saved.
  it("writes nothing for a body that is no video container", async () => {
    const projectDir = projectWith(ENTRY(0, { filename: "x.html" }));
    answer(Buffer.alloc(4096, "a"));
    await runVideoMode({ project: projectDir, index: "0" });
    expect(consumeCommandResult().exitCode).toBe(1);
    expect(readdirSync(join(projectDir, "assets", "videos"))).toEqual([]);
  });
});
