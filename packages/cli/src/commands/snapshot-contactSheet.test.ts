import { runCommand } from "citty";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const capture = vi.hoisted(() => ({
  evaluate: vi.fn(),
  screenshot: vi.fn(async ({ path }: { path: string }) => {
    const bytes = Buffer.from("captured PNG");
    writeFileSync(path, bytes);
    return bytes;
  }),
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
}));

vi.mock("../utils/staticProjectServer.js", () => ({
  serveStaticProjectHtml: vi.fn(async () => ({
    url: "http://127.0.0.1:1",
    close: capture.closeServer,
  })),
}));

vi.mock("@hyperframes/engine", () => ({
  injectVideoFramesBatch: vi.fn(async () => []),
  syncVideoFrameVisibility: vi.fn(async () => undefined),
  extractMediaMetadata: vi.fn(),
}));

import snapshotCommand from "./snapshot.js";

describe("snapshot contact sheet failures", () => {
  let project: string;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    project = mkdtempSync(join(tmpdir(), "hf-snapshot-contact-sheet-"));
    writeFileSync(
      join(project, "index.html"),
      '<html><body><div id="root" data-composition-id="main" data-width="640" data-height="360" data-start="0" data-duration="2">Visible</div><script>window.__timelines = { main: { duration() { return 2; }, seek() {} } };</script></body></html>',
    );
    capture.evaluate
      .mockReset()
      .mockResolvedValueOnce({ loaded: [], errored: [], unused: [] })
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.doUnmock("../capture/contactSheet.js");
    vi.doUnmock("sharp");
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
        vi.doMock("sharp", () => ({
          get default() {
            throw new Error(message);
          },
        }));
      } else {
        vi.doMock("../capture/contactSheet.js", () => ({ createSnapshotContactSheet: generate }));
      }

      await expect(
        runCommand(snapshotCommand, {
          rawArgs: [project, "--at", "0.5,1", "--no-end", "--describe", "false"],
        }),
      ).resolves.toBeDefined();

      expect(console.error).not.toHaveBeenCalled();
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
      rawArgs: [project, "--at", "0.5,1", "--no-end", "--describe", "false"],
    });

    expect(generate).toHaveBeenCalledWith(join(project, "snapshots"), sheet);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("contact-sheet.jpg"));
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });
});
