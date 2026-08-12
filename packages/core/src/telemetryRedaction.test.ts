import { describe, expect, it } from "vitest";
import { redactKnownPaths, redactTelemetryString } from "./telemetryRedaction.js";

describe("redactTelemetryString", () => {
  it("redacts macOS, Linux, Windows, file URLs, and URL query strings", () => {
    expect(
      redactTelemetryString(
        [
          "/Users/alice/project/video.mp4",
          "/home/ubuntu/project/video.mp4",
          "/workspace/app/video.mp4",
          "C:\\Users\\Alice\\project\\video.mp4",
          "file:///tmp/render/video.mp4",
          "https://example.com/video.mp4?token=secret",
        ].join(" "),
      ),
    ).toBe("[path] [path] [path] [path] [file-url] https://example.com/video.mp4?…");
  });

  // The redactor used to enumerate roots (/Users, /home, /opt, /tmp, …). Any
  // root outside that list reached telemetry verbatim, which is most of them.
  it.each([
    "/data/media/interview.mov",
    "/mnt2/nfs/share/take3.wav",
    "/srv2/renders/2026/final.mp4",
    "/nix/store/abc123/asset.png",
  ])("redacts the non-allowlisted absolute root in %s", (path) => {
    const out = redactTelemetryString(`ffprobe failed reading ${path}`);
    expect(out).not.toContain("/");
    expect(out).toContain("[path]");
  });

  it("redacts relative paths, including a dash-prefixed one", () => {
    expect(redactTelemetryString("could not open ./assets/-weird-name.mp3")).toBe(
      "could not open [path]",
    );
    expect(redactTelemetryString("could not open ../-out.wav")).toBe("could not open [path]");
    expect(redactTelemetryString("could not open .\\tmp\\-x.aac")).toBe("could not open [path]");
  });

  it("redacts a bare basename — a caller may pass one instead of a path", () => {
    expect(redactTelemetryString("Invalid data found in my-client-cut.mp4")).toBe(
      "Invalid data found in [file]",
    );
  });

  // Over-redaction is cheap; these are ordinary in ffprobe stderr and turning
  // them into [path] would make a diagnostic string useless.
  it.each(["N/A", "24/1", "Stream #0:0", "moov atom not found", "48000/1001"])(
    "leaves %s alone",
    (text) => {
      expect(redactTelemetryString(`ffprobe: ${text}`)).toBe(`ffprobe: ${text}`);
    },
  );

  // A `?` is illegal in a Windows filename, so this is not a query string —
  // the whole token is path, and must not survive by hiding behind a `?`.
  it("consumes the rest of the token once a path is established", () => {
    expect(redactTelemetryString("Navigation failed for C:\\Users\\A\\v.mov?not-a-query")).toBe(
      "Navigation failed for [path]",
    );
  });

  it("truncates after redacting, so a long path cannot survive by being cut", () => {
    const out = redactTelemetryString(`/data/${"x".repeat(500)}/a.mp4`, 40);
    expect(out).not.toContain("xxx");
  });

  // Named explicitly in review: a relative path with NO `./` prefix was
  // missed by both the absolute rule (needs a leading slash) and the `./`
  // rule (needs the dot), so it reached telemetry completely unredacted.
  it.each([
    "customer/acme-secret/video.mp4",
    "assets/bgm.mp3",
    "projects/client-name/cut/final.mov",
    "a\\b\\c.wav",
  ])("redacts the bare relative path %s", (path) => {
    const out = redactTelemetryString(`Invalid data found when processing ${path}`);
    expect(out).toBe("Invalid data found when processing [path]");
  });

  it("redacts a dash-prefixed bare basename", () => {
    expect(redactTelemetryString("could not open -customer-secret-intro.mp4")).toBe(
      "could not open [file]",
    );
  });
});

// The segment classes were ASCII `\w`, so a non-Latin path went out verbatim.
// This redactor also feeds CLI telemetry and producer observation messages,
// where no known-path list is supplied to compensate.
describe("non-Latin paths", () => {
  it.each([
    "/数据/客户/秘密视频.mp4",
    "/данные/клиент/видео.mp4",
    "/data/客户/secret.mp4",
    "/Users/alice/проект/видео.mp4",
  ])("redacts the absolute path %s", (path) => {
    const out = redactTelemetryString(`ffprobe failed reading ${path}`);
    expect(out).toBe("ffprobe failed reading [path]");
  });

  it("redacts a non-Latin bare relative path without stranding the first segment", () => {
    // The lookbehind used to be `\w`-based, so a match could start mid-token
    // when the preceding character was non-ASCII: this redacted to `客户[path]`.
    expect(redactTelemetryString("could not open 客户/秘密/视频.mp4")).toBe(
      "could not open [path]",
    );
  });

  it.each(["./资产/背景.mp3", "../输出/final.wav"])("redacts the relative path %s", (path) => {
    expect(redactTelemetryString(`could not open ${path}`)).toBe("could not open [path]");
  });

  it("redacts a non-Latin bare basename", () => {
    expect(redactTelemetryString("Invalid data found in 秘密视频.mp4")).toBe(
      "Invalid data found in [file]",
    );
  });
});

describe("redactKnownPaths", () => {
  // Shape matching has holes by construction. A caller that built the argv
  // knows the exact path, so it can name it instead of hoping a regex does.
  it("redacts an exact path a regex would not recognise as one", () => {
    const weird = "acme_secret_project";
    expect(redactKnownPaths(`ffprobe: ${weird}: Invalid data`, [weird])).toBe(
      "ffprobe: [path]: Invalid data",
    );
  });

  it("redacts the basename too — ffprobe often reports only that", () => {
    const out = redactKnownPaths("moov atom not found in secret-cut.mp4", [
      "/data/x/secret-cut.mp4",
    ]);
    expect(out).toContain("[path]");
    expect(out).not.toContain("secret-cut");
  });

  it("leaves the message alone when no path was supplied", () => {
    expect(redactKnownPaths("moov atom not found", [])).toBe("moov atom not found");
  });

  // Guards against a one/two-character basename turning every occurrence of
  // that letter into [path].
  it("ignores paths too short to be distinctive", () => {
    expect(redactKnownPaths("a stream at a rate", ["a"])).toBe("a stream at a rate");
  });

  // This sits on an error path: throwing here turns a reported failure into an
  // unhandled rejection, which is what a non-Error rejection's `undefined`
  // message caused.
  it.each([undefined, null, 42, {}])("returns a string for the non-string input %s", (value) => {
    expect(() => redactKnownPaths(value as unknown as string, ["/tmp/x.mp4"])).not.toThrow();
  });
});
