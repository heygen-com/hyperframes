import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildDoctorReport, redactHome, parseToolVersion, type CheckOutcome } from "./doctor.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

const OUTCOMES_ALL_OK: CheckOutcome[] = [
  { name: "Version", ok: true, detail: "0.4.4 (latest)" },
  { name: "Node.js", ok: true, detail: "v22.0.0 (darwin arm64)" },
  { name: "FFmpeg", ok: true, detail: "ffmpeg version 8.1" },
];

const OUTCOMES_WITH_FAILURE: CheckOutcome[] = [
  { name: "Version", ok: true, detail: "0.4.4 (latest)" },
  {
    name: "Docker",
    ok: false,
    detail: "Not found",
    hint: "https://docs.docker.com/get-docker/",
  },
];

describe("redactHome", () => {
  const originalHome = process.env["HOME"];
  const originalUserProfile = process.env["USERPROFILE"];

  afterEach(() => {
    if (originalHome !== undefined) process.env["HOME"] = originalHome;
    else delete process.env["HOME"];
    if (originalUserProfile !== undefined) process.env["USERPROFILE"] = originalUserProfile;
    else delete process.env["USERPROFILE"];
  });

  it("replaces HOME paths with the literal $HOME", () => {
    process.env["HOME"] = "/Users/alice";
    delete process.env["USERPROFILE"];
    expect(redactHome("system: /Users/alice/Library/Caches/chrome")).toBe(
      "system: $HOME/Library/Caches/chrome",
    );
  });

  it("replaces all occurrences, not just the first", () => {
    process.env["HOME"] = "/home/bob";
    delete process.env["USERPROFILE"];
    expect(redactHome("/home/bob/a and /home/bob/b")).toBe("$HOME/a and $HOME/b");
  });

  it("falls back to USERPROFILE when HOME is unset (Windows)", () => {
    delete process.env["HOME"];
    process.env["USERPROFILE"] = "C:\\Users\\carol";
    expect(redactHome("C:\\Users\\carol\\AppData")).toBe("$HOME\\AppData");
  });

  it("is a no-op when neither HOME nor USERPROFILE is set", () => {
    delete process.env["HOME"];
    delete process.env["USERPROFILE"];
    expect(redactHome("/Users/someone/path")).toBe("/Users/someone/path");
  });

  it("leaves strings without HOME unchanged", () => {
    process.env["HOME"] = "/Users/alice";
    expect(redactHome("brew install ffmpeg")).toBe("brew install ffmpeg");
  });
});

describe("parseToolVersion", () => {
  it("extracts ffmpeg version from full copyright line", () => {
    expect(
      parseToolVersion("ffmpeg version 8.1.1 Copyright (c) 2000-2026 the FFmpeg developers"),
    ).toBe("ffmpeg 8.1.1");
  });

  it("extracts ffprobe version from full copyright line", () => {
    expect(
      parseToolVersion("ffprobe version 8.1.1 Copyright (c) 2007-2026 the FFmpeg developers"),
    ).toBe("ffprobe 8.1.1");
  });

  it("handles Windows gyan.dev builds with suffix", () => {
    expect(
      parseToolVersion(
        "ffmpeg version 7.1.1-essentials_build-www.gyan.dev Copyright (c) 2000-2024",
      ),
    ).toBe("ffmpeg 7.1.1-essentials_build-www.gyan.dev");
  });

  it("returns trimmed input when pattern does not match", () => {
    expect(parseToolVersion("  some unrecognized output  ")).toBe("some unrecognized output");
  });
});

describe("buildDoctorReport", () => {
  it("emits the locked schema shape", () => {
    const report = buildDoctorReport(OUTCOMES_ALL_OK);

    expect(report).toMatchObject({
      ok: expect.any(Boolean),
      platform: expect.any(String),
      arch: expect.any(String),
      checks: expect.any(Array),
      _meta: expect.objectContaining({
        version: expect.any(String),
        updateAvailable: expect.any(Boolean),
      }),
    });

    // Top-level keys are exactly these — any accidental addition or rename
    // should force an explicit update to this test + PR review.
    expect(Object.keys(report).sort()).toEqual(["_meta", "arch", "checks", "ok", "platform"]);
  });

  it("reports ok=true when all checks pass", () => {
    expect(buildDoctorReport(OUTCOMES_ALL_OK).ok).toBe(true);
  });

  it("reports ok=false when any check fails", () => {
    expect(buildDoctorReport(OUTCOMES_WITH_FAILURE).ok).toBe(false);
  });

  it("preserves check order exactly as provided", () => {
    const report = buildDoctorReport(OUTCOMES_ALL_OK);
    expect(report.checks.map((c) => c.name)).toEqual(["Version", "Node.js", "FFmpeg"]);
  });

  it("omits hint when not provided (doesn't emit hint:undefined)", () => {
    const report = buildDoctorReport([{ name: "X", ok: true, detail: "fine" }]);
    expect(report.checks[0]).toEqual({ name: "X", ok: true, detail: "fine" });
    expect("hint" in report.checks[0]!).toBe(false);
  });

  it("preserves hint when provided", () => {
    const report = buildDoctorReport(OUTCOMES_WITH_FAILURE);
    const docker = report.checks.find((c) => c.name === "Docker");
    expect(docker?.hint).toBe("https://docs.docker.com/get-docker/");
  });

  describe("redact option", () => {
    const originalHome = process.env["HOME"];
    beforeEach(() => {
      process.env["HOME"] = "/Users/alice";
    });
    afterEach(() => {
      if (originalHome !== undefined) process.env["HOME"] = originalHome;
      else delete process.env["HOME"];
    });

    it("redacts HOME in detail and hint when redact=true", () => {
      const outcomes: CheckOutcome[] = [
        {
          name: "Chrome",
          ok: false,
          detail: "system: /Users/alice/Applications/Chrome",
          hint: "Try /Users/alice/bin/chrome",
        },
      ];
      const report = buildDoctorReport(outcomes, { redact: true });
      expect(report.checks[0]?.detail).toBe("system: $HOME/Applications/Chrome");
      expect(report.checks[0]?.hint).toBe("Try $HOME/bin/chrome");
    });

    it("leaves HOME alone when redact is off (default)", () => {
      const outcomes: CheckOutcome[] = [
        { name: "Chrome", ok: true, detail: "/Users/alice/Chrome" },
      ];
      expect(buildDoctorReport(outcomes).checks[0]?.detail).toBe("/Users/alice/Chrome");
    });
  });
});
