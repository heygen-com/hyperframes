import { execFileSync } from "node:child_process";
import { runCommand } from "citty";
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const errorsBesideProgress = () =>
  vi
    .mocked(console.error)
    .mock.calls.filter(([line]) => !String(line).startsWith("[hyperframes] snapshot:"));

const capture = vi.hoisted(() => ({
  evaluate: vi.fn(),
  screenshot: vi.fn(async () => Buffer.from("captured PNG")),
  closeBrowser: vi.fn(async () => undefined),
  closeServer: vi.fn(async () => undefined),
  seek: vi.fn(async () => undefined),
}));

vi.mock("../capture/captureCompositionFrame.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../capture/captureCompositionFrame.js")>()),
  openSettledCompositionPage: vi.fn(async () => ({
    browser: { close: capture.closeBrowser },
    page: { evaluate: capture.evaluate, screenshot: capture.screenshot },
    renderReadyTimedOut: false,
  })),
  seekCompositionTimeline: capture.seek,
  seekCompositionTimelineOnly: capture.seek,
  settleCompositionSeek: vi.fn(async () => ({ pending: [], failed: [] })),
}));

vi.mock("../utils/staticProjectServer.js", () => ({
  serveStaticProjectHtml: vi.fn(async () => ({
    url: "http://127.0.0.1:1",
    close: capture.closeServer,
  })),
}));

vi.mock("@hyperframes/engine", () => ({
  DEFAULT_CONFIG: { playerReadyTimeout: 45_000 },
  injectVideoFramesBatch: vi.fn(async () => []),
  syncVideoFrameVisibility: vi.fn(async () => undefined),
  extractMediaMetadata: vi.fn(),
}));

import snapshotCommand, { SNAPSHOT_IMAGE_NAME } from "./snapshot.js";
import { planReview, reviewFrames } from "./snapshotReview.js";
import { findFFmpeg, findFFprobe } from "../browser/ffmpeg.js";
import { historyDeps } from "../utils/historyOwner.js";
import { openProjectHistory } from "@hyperframes/studio-server/history";

/** The page's answers for one run: asset check, duration, ready, then two per frame. */
function primePage(frames: number) {
  capture.evaluate
    .mockReset()
    .mockResolvedValueOnce({ loaded: [], errored: [], unused: [] })
    .mockResolvedValueOnce(2)
    .mockResolvedValueOnce(true);
  for (let i = 0; i < frames; i++) {
    capture.evaluate.mockResolvedValueOnce([]).mockResolvedValueOnce(undefined);
  }
}

const PROJECT_HTML =
  '<html><body><div id="root" data-composition-id="main" data-width="640" data-height="360" data-start="0" data-duration="2">Visible</div><script>window.__timelines = { main: { duration() { return 2; }, seek() {} } };</script></body></html>';

describe("snapshot contact sheet failures", () => {
  let project: string;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    project = mkdtempSync(join(tmpdir(), "hf-snapshot-contact-sheet-"));
    writeFileSync(join(project, "index.html"), PROJECT_HTML);
    primePage(2);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.doUnmock("../capture/contactSheet.js");
    vi.doUnmock("../utils/optionalPackages.js");
    vi.restoreAllMocks();
    rmSync(project, { recursive: true, force: true });
  });

  it.each(["import", "generation"])(
    "warns and preserves every captured frame when contact sheet %s fails",
    async (failure) => {
      const message =
        failure === "import"
          ? 'Could not load the "sharp" module: libvips-cpp-8.18.7.dll was blocked'
          : "Unable to decode image for contact sheet";
      const generate = vi.fn(async () => {
        throw new Error(message);
      });
      if (failure === "import") {
        vi.doMock("../utils/optionalPackages.js", async (importOriginal) => ({
          ...(await importOriginal<typeof import("../utils/optionalPackages.js")>()),
          loadSharp: async () => {
            throw new Error(message);
          },
        }));
      } else {
        vi.doMock("../capture/contactSheet.js", () => ({ createSnapshotContactSheet: generate }));
      }

      await expect(
        runCommand(snapshotCommand, {
          rawArgs: [
            project,
            ...["--at", "0.5,1", "--no-end", "--describe", "false"],
            ...["--output", join(project, "snapshots")],
          ],
        }),
      ).resolves.toBeDefined();

      expect(errorsBesideProgress()).toEqual([]);
      for (const [index, time] of ["0.5", "1"].entries()) {
        const frame = join(project, "snapshots", `frame-0${index}-at-${time}s.png`);
        expect(readFileSync(frame)).toEqual(Buffer.from("captured PNG"));
      }
      expect(capture.screenshot).toHaveBeenCalledTimes(2);
      expect(capture.closeBrowser).toHaveBeenCalledOnce();
      expect(capture.closeServer).toHaveBeenCalledOnce();
      if (failure === "generation") expect(generate).toHaveBeenCalledOnce();
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Contact sheet skipped:"));
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(message));
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining("Individual snapshot PNGs are still available"),
      );
    },
  );

  it("reports a generated contact sheet without a warning", async () => {
    const sheet = join(project, "snapshots", "contact-sheet.jpg");
    const generate = vi.fn(async () => [sheet]);
    vi.doMock("../capture/contactSheet.js", () => ({ createSnapshotContactSheet: generate }));

    await runCommand(snapshotCommand, {
      rawArgs: [
        project,
        ...["--at", "0.5,1", "--no-end", "--describe", "false"],
        ...["--output", join(project, "snapshots")],
      ],
    });

    expect(generate).toHaveBeenCalledWith(
      ["frame-00-at-0.5s.png", "frame-01-at-1s.png"].map((name) =>
        join(project, "snapshots", name),
      ),
      sheet,
    );
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("contact-sheet.jpg"));
    expect(console.warn).not.toHaveBeenCalled();
    expect(errorsBesideProgress()).toEqual([]);
  });

  it("builds the sheet from this run's frames, not another frame-*.png in the folder", async () => {
    const output = join(project, "snapshots");
    mkdirSync(output, { recursive: true });
    writeFileSync(join(output, "frame-hero.png"), "user image");
    const read: string[] = [];
    const image = {
      metadata: async () => ({ width: 640, height: 360, autoOrient: { width: 640, height: 360 } }),
      autoOrient: () => image,
      resize: () => image,
      composite: () => image,
      jpeg: () => image,
      toBuffer: async () => Buffer.from("sheet"),
    };
    vi.doMock("../utils/optionalPackages.js", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../utils/optionalPackages.js")>()),
      loadSharp: async () => (input: unknown) => {
        if (typeof input === "string") read.push(input);
        return image;
      },
    }));

    await runCommand(snapshotCommand, {
      rawArgs: [project, ...["--at", "0.5,1", "--no-end", "--describe", "false", "-o", output]],
    });

    expect([...new Set(read)]).toEqual([
      join(output, "frame-00-at-0.5s.png"),
      join(output, "frame-01-at-1s.png"),
    ]);
    expect(readFileSync(join(output, "frame-hero.png"), "utf8")).toBe("user image");
    expect(console.warn).not.toHaveBeenCalled();
  });

  it.each(["-1", "0.5,-1", "Infinity", "NaN", "1,", "1junk", ""])(
    "refuses --at %s before writing anything",
    async (at) => {
      const output = join(project, "snapshots");
      await expect(
        runCommand(snapshotCommand, {
          rawArgs: [project, "--at", at, "--no-end", "--describe", "false", "-o", output],
        }),
      ).rejects.toThrow("--at must be comma-separated times in seconds, each 0 or more");
      expect(capture.screenshot).not.toHaveBeenCalled();
      expect(existsSync(output)).toBe(false);
    },
  );

  describe("--against when the pair sheet cannot be made", () => {
    const ffmpeg = findFFmpeg();
    const noFfmpeg = !ffmpeg || !findFFprobe();
    const sharpBlocked = [
      'Could not load the "sharp" module using the win32-x64 runtime',
      "ERR_DLOPEN_FAILED: An Application Control policy has blocked this file.",
      "Possible solutions:",
    ].join("\n");

    function againstArgs(reference: string) {
      return {
        rawArgs: [
          project,
          ...["--at", "0.5,1", "--no-end", "--describe", "false"],
          ...["--against", reference, "--output", join(project, "snapshots")],
        ],
      };
    }

    function makeReference(): string {
      const reference = join(project, "reference.mp4");
      execFileSync(ffmpeg!, [
        ...["-hide_banner", "-loglevel", "error", "-f", "lavfi"],
        ...["-i", "testsrc=d=2:r=24:s=160x90", "-pix_fmt", "yuv420p", reference],
      ]);
      return reference;
    }

    it.skipIf(noFfmpeg)(
      "warns once when sharp cannot load and keeps every frame and reference",
      async () => {
        const reference = makeReference();
        const pairSheet = vi.fn(async () => {
          throw new Error(sharpBlocked);
        });
        vi.doMock("../capture/contactSheet.js", () => ({
          createContactSheet: pairSheet,
          createSnapshotContactSheet: vi.fn(async () => {
            throw new Error(sharpBlocked);
          }),
        }));

        await expect(runCommand(snapshotCommand, againstArgs(reference))).resolves.toBeDefined();

        const out = join(project, "snapshots");
        for (const slot of ["00-at-0.5s", "01-at-1s"]) {
          expect(readFileSync(join(out, `frame-${slot}.png`))).toEqual(Buffer.from("captured PNG"));
          expect(existsSync(join(out, `ref-${slot}.png`))).toBe(true);
        }
        expect(readdirSync(out).filter((name) => name.startsWith("pair-"))).toEqual([]);
        expect(pairSheet).toHaveBeenCalledOnce();
        expect(errorsBesideProgress()).toHaveLength(1);
        expect(console.error).toHaveBeenCalledWith(
          expect.stringContaining("Reference pair sheets skipped: Windows App Control"),
        );
        const logged = vi.mocked(console.log).mock.calls.map((call) => String(call[0]));
        expect(logged.some((line) => line.includes("ref-*.png"))).toBe(true);
        expect(logged.some((line) => line.includes("pair-*.jpg"))).toBe(false);
      },
    );

    it.skipIf(noFfmpeg)("still fails the snapshot for any other pair sheet error", async () => {
      const reference = makeReference();
      vi.doMock("../capture/contactSheet.js", () => ({
        createContactSheet: vi.fn(async () => {
          throw new Error("Unable to decode image for pair sheet");
        }),
      }));

      await expect(runCommand(snapshotCommand, againstArgs(reference))).rejects.toThrow(
        "Command failed",
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("Snapshot failed: Unable to decode image for pair sheet"),
      );
      expect(capture.closeBrowser).toHaveBeenCalledOnce();
      expect(capture.closeServer).toHaveBeenCalledOnce();
    });
  });

  it("keeps and records the captured frames when another process holds history", async () => {
    const args = {
      rawArgs: [
        project,
        ...["--at", "0.5,1", "--no-end", "--describe", "false"],
        ...["--output", join(project, "snapshots")],
      ],
    };
    await runCommand(snapshotCommand, args);
    const statePath = join(project, ".hyperframes", "video-state.json");
    const recorded = JSON.parse(readFileSync(statePath, "utf8"));
    expect(recorded.snapshots.unversioned.length).toBeGreaterThan(0);

    const previousWait = historyDeps.ownerWaitMs;
    historyDeps.ownerWaitMs = 0;
    const held = await openProjectHistory({
      projectDir: project,
      historyRoot: historyDeps.historyRoot,
      ownerWaitMs: 0,
    });
    capture.screenshot.mockImplementation(async () => Buffer.from("replaced PNG"));
    primePage(2);
    try {
      await runCommand(snapshotCommand, args);
      for (const [index, time] of ["0.5", "1"].entries()) {
        const frame = join(project, "snapshots", `frame-0${index}-at-${time}s.png`);
        expect(readFileSync(frame)).toEqual(Buffer.from("replaced PNG"));
      }
      const after = JSON.parse(readFileSync(statePath, "utf8"));
      expect(after.snapshots.unversioned.map((record: { image: string }) => record.image)).toEqual(
        ["0.5", "1"].map((time, index) =>
          join(project, "snapshots", `frame-0${index}-at-${time}s.png`),
        ),
      );
      expect(errorsBesideProgress()).toEqual([]);
      expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining("not recorded"));
    } finally {
      historyDeps.ownerWaitMs = previousWait;
      await held.close();
    }
  });

  it("describes frames without resizing when sharp is absent and installs are off", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("HYPERFRAMES_NO_OPTIONAL_INSTALL", "sharp");
    const generateContent = vi.fn(async (_request: unknown) => ({ text: "a described frame" }));
    const loadSharp = vi.fn(async () => {
      throw new Error(
        "sharp is not installed, and HYPERFRAMES_NO_OPTIONAL_INSTALL turns off installing it",
      );
    });
    vi.doMock("../utils/optionalPackages.js", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../utils/optionalPackages.js")>()),
      loadInstalledSharp: () => null,
      loadSharp,
      loadOptionalPackage: async () => ({
        GoogleGenAI: class {
          models = { generateContent };
        },
      }),
    }));
    const { default: command } = await import("./snapshot.js");

    try {
      await runCommand(command, {
        rawArgs: [
          project,
          ...["--at", "0.5,1", "--no-end", "--describe", "true"],
          ...["--output", join(project, "snapshots")],
        ],
      });

      expect(generateContent).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(generateContent.mock.calls[0]?.[0])).toContain(
        '"mimeType":"image/png"',
      );
      expect(readFileSync(join(project, "snapshots", "descriptions.md"), "utf8")).toContain(
        "a described frame",
      );
      expect(loadSharp).not.toHaveBeenCalledWith("--describe");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.each([
    ["no --describe flag", [], null],
    ["--describe false", ["--describe", "false"], null],
    ["a bare --describe", ["--describe"], "Describe this video composition frame"],
    ["--describe with a question", ["--describe", "Is the logo visible?"], "Is the logo visible?"],
  ])("with a Gemini key set, %s", async (_, describeArgs, prompt) => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("GOOGLE_API_KEY", "test-key");
    const generateContent = vi.fn(async (_request: unknown) => ({ text: "a described frame" }));
    const loadOptionalPackage = vi.fn(async () => ({
      GoogleGenAI: class {
        models = { generateContent };
      },
    }));
    vi.doMock("../utils/optionalPackages.js", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../utils/optionalPackages.js")>()),
      loadInstalledSharp: () => null,
      loadOptionalPackage,
    }));
    const { default: command } = await import("./snapshot.js");
    const output = join(project, "snapshots");

    try {
      await runCommand(command, {
        rawArgs: [project, ...["--at", "0.5,1", "--no-end", "-o", output], ...describeArgs],
      });

      if (prompt === null) {
        expect(loadOptionalPackage).not.toHaveBeenCalled();
        expect(generateContent).not.toHaveBeenCalled();
        expect(existsSync(join(output, "descriptions.md"))).toBe(false);
      } else {
        expect(generateContent).toHaveBeenCalledTimes(2);
        expect(JSON.stringify(generateContent.mock.calls[0]?.[0])).toContain(prompt);
        expect(readFileSync(join(output, "descriptions.md"), "utf8")).toContain(prompt);
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("snapshot --keep", () => {
  let project: string;
  let stills: string;

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), "hf-snapshot-keep-"));
    stills = join(project, "boards", "stills");
    writeFileSync(join(project, "index.html"), PROJECT_HTML);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(project, { recursive: true, force: true });
  });

  async function snapshot(at: string, bytes: string) {
    capture.screenshot.mockImplementation(async () => Buffer.from(bytes));
    primePage(at.split(",").length);
    await runCommand(snapshotCommand, {
      rawArgs: [project, "--keep", "--at", at, "--no-end", "--describe", "false", "-o", stills],
    });
  }

  it("redoes one moment and keeps every other still", async () => {
    await snapshot("0,0.5,1.5", "first PNG");
    await snapshot("0.5", "redo PNG");

    expect(readdirSync(stills).sort()).toEqual(["at-0.5s.png", "at-0s.png", "at-1.5s.png"]);
    expect(readFileSync(join(stills, "at-0s.png"), "utf8")).toBe("first PNG");
    expect(readFileSync(join(stills, "at-0.5s.png"), "utf8")).toBe("redo PNG");
    expect(readFileSync(join(stills, "at-1.5s.png"), "utf8")).toBe("first PNG");
    expect(existsSync(join(stills, "contact-sheet.jpg"))).toBe(false);
  });

  it("refuses two times that would share a still, before touching the folder", async () => {
    await snapshot("1.5", "first PNG");
    capture.screenshot.mockClear();

    await expect(snapshot("1.5,1.5004", "second PNG")).rejects.toThrow(
      "--keep would name both 1.5 and 1.5004 at-1.5s.png",
    );
    expect(capture.screenshot).not.toHaveBeenCalled();
    expect(readFileSync(join(stills, "at-1.5s.png"), "utf8")).toBe("first PNG");
  });

  it("replaces a linked still without writing through the link", async () => {
    mkdirSync(stills, { recursive: true });
    const hardVictim = join(project, "hard-victim.png");
    writeFileSync(hardVictim, "hard victim");
    linkSync(hardVictim, join(stills, "at-0.5s.png"));
    const softVictim = join(project, "soft-victim.png");
    writeFileSync(softVictim, "soft victim");
    if (process.platform !== "win32") symlinkSync(softVictim, join(stills, "at-1.5s.png"));

    await snapshot("0.5,1.5", "new PNG");

    expect(readFileSync(hardVictim, "utf8")).toBe("hard victim");
    expect(readFileSync(softVictim, "utf8")).toBe("soft victim");
    for (const still of ["at-0.5s.png", "at-1.5s.png"]) {
      expect(lstatSync(join(stills, still)).isFile()).toBe(true);
      expect(readFileSync(join(stills, still), "utf8")).toBe("new PNG");
    }
  });
});

describe("snapshot --output", () => {
  let project: string;

  const USER_IMAGES = ["hero.png", "logo.jpg", "Notes.PNG", "frame-hero.png"];
  const PREVIOUS_RUN = [
    "frame-00-at-0.25s.png",
    "frame-07-at-12.5s.png",
    "at-3s.png",
    "ref-00-at-0.25s.png",
    "pair-00-at-0.25s.jpg",
    "contact-sheet-2.jpg",
    "beat-01-at-0.3s.png",
    "seam-01-3-at-6s.png",
    "review-beats.jpg",
    "review-seam-01.jpg",
    "review-phone-2.jpg",
  ];

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), "hf-snapshot-output-"));
    writeFileSync(join(project, "index.html"), PROJECT_HTML);
    capture.screenshot.mockImplementation(async () => Buffer.from("captured PNG"));
    primePage(2);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(project, { recursive: true, force: true });
  });

  it.each([
    ["a snapshots folder", "snapshots"],
    ["the project folder", "."],
    ["the assets folder", "assets"],
  ])("replaces the previous run's images in %s and keeps every other image", async (_, sub) => {
    const output = join(project, sub);
    mkdirSync(output, { recursive: true });
    for (const name of [...USER_IMAGES, ...PREVIOUS_RUN]) writeFileSync(join(output, name), name);

    await runCommand(snapshotCommand, {
      rawArgs: [project, ...["--at", "0.5,1", "--no-end", "--describe", "false", "-o", output]],
    });

    for (const name of USER_IMAGES) expect(readFileSync(join(output, name), "utf8")).toBe(name);
    for (const name of PREVIOUS_RUN) expect(existsSync(join(output, name))).toBe(false);
    for (const name of ["frame-00-at-0.5s.png", "frame-01-at-1s.png"]) {
      expect(readFileSync(join(output, name), "utf8")).toBe("captured PNG");
    }
  });

  it("names every review still with a name the next run clears", () => {
    const plan = planReview(
      {
        window: [0, 10],
        scenes: [
          { id: "a", start: 0, end: 4 },
          { id: "b", start: 4, end: 10 },
        ],
        beats: [],
        notes: [],
      },
      10,
    );
    const files = reviewFrames(plan).map((frame) => frame.file);
    expect(files.some((file) => file.startsWith("seam-"))).toBe(true);
    for (const file of files) expect(file).toMatch(SNAPSHOT_IMAGE_NAME);
  });
});
