import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ prepare: vi.fn(), filesForExport: vi.fn(), factory: vi.fn() }));
vi.mock("@hyperframes/share", () => ({ shareSources: mocks.factory }));
vi.mock("./render.js", () => ({ latestShareRender: () => ({ fingerprint: "rendered" }) }));
import { prepareCliShareSource, ShareSourceError } from "./sources.js";
import { shareError } from "./errors.js";
const access = async () => ({
  token: "test",
  heygen: "https://app.test",
  heygenApi: "https://api.test",
  owner: "owner",
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.factory.mockReturnValue({ prepare: mocks.prepare, filesForExport: mocks.filesForExport });
});
it("eligible source requires attachment on the version", async () => {
  const snapshot = { space_id: "space", composition_id: "composition", snapshot_id: "snapshot" };
  mocks.prepare.mockResolvedValue({ at: "ready", snapshot });
  expect(await prepareCliShareSource("/project", access, "space", { shareFiles: true })).toEqual({
    source: { at: "ready", snapshot },
    requireSource: true,
    filesForExport: mocks.filesForExport,
  });
  expect(mocks.prepare).toHaveBeenCalledWith("/project", "rendered");
});
it("free plan ineligibility preserves video sharing and reports source unavailable", async () => {
  mocks.prepare.mockResolvedValue({ at: "unavailable", reason: "source_plan_required" });
  expect(await prepareCliShareSource("/project", access, "space", { shareFiles: true })).toEqual({
    source: { at: "video_only", reason: "source_plan_required" },
    requireSource: false,
  });
});
it("explicit video-only skips source network requests", async () => {
  await prepareCliShareSource("/project", access, "space", { shareFiles: true, videoOnly: true });
  expect(mocks.factory).not.toHaveBeenCalled();
});
it("unexpected upload errors and stale source block with an explicit video-only retry", async () => {
  mocks.prepare.mockRejectedValueOnce(new Error("network failed"));
  await expect(
    prepareCliShareSource("/project", access, "space", { shareFiles: true }),
  ).rejects.toThrow("--video-only");
  mocks.prepare.mockResolvedValue({ at: "unavailable", reason: "source_render_changed" });
  await expect(
    prepareCliShareSource("/project", access, "space", { shareFiles: true }),
  ).rejects.toThrow("--video-only");
});

it("source failure has a stable bridge and JSON error code", () => {
  expect(shareError(new ShareSourceError("Retry or choose video-only"))).toEqual({
    code: "source_unavailable",
    message: "Retry or choose video-only",
  });
});
