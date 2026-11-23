import { afterEach, expect, it, vi } from "vitest";

const skipped = vi.hoisted(() => ({ path: undefined as string | undefined }));
vi.mock("@hyperframes/parsers/ff-binaries", () => ({
  findFfBinary: () => undefined,
  getSkippedX86Binary: () => skipped.path,
}));
vi.mock("@hyperframes/engine", () => ({ getCachedGpuEncoder: vi.fn() }));

const { getFFmpegInstallHint } = await import("./ffmpeg.js");

afterEach(() => {
  skipped.path = undefined;
  vi.restoreAllMocks();
});

// fails without the fix: the path of the binary that was passed over was printed as found
it("shows control characters in an ignored binary's path as text", () => {
  skipped.path = "/opt/tools\u0007/ffmpeg";

  const hint = getFFmpegInstallHint();

  expect(hint).toContain("(ignored /opt/tools\\x07/ffmpeg: x86_64 only");
  expect(hint).not.toContain("\u0007");
});
