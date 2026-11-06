import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  version: vi.fn(),
  record: vi.fn(),
  project: vi.fn(),
  spaces: vi.fn(),
  flags: vi.fn(),
  render: vi.fn(),
  create: vi.fn(),
  add: vi.fn(),
  pending: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@hyperframes/share", () => ({
  reviewClient: () => ({ project: mocks.project, spaces: mocks.spaces, reviewFlags: mocks.flags }),
  reviewStatus: mocks.status,
  reviewVersion: mocks.version,
  reviewRecord: mocks.record,
  shareForReview: mocks.create,
  addVersion: mocks.add,
  pendingReviewExport: mocks.pending,
  refreshReviewExport: mocks.refresh,
  setReviewAccess: vi.fn(),
  turnOffReviewLink: vi.fn(),
  ReviewFailed: class extends Error {
    constructor(
      public status: number,
      public reason: string,
    ) {
      super(reason);
    }
  },
}));
vi.mock("./auth.js", () => ({
  createShareAccess: () => ({ access: vi.fn() }),
  shareSite: () => "https://hyperframes.dev",
}));
vi.mock("./host.js", () => ({
  assertReviewUploadStorage: vi.fn(),
  bindCliShareProject: (path: string) => path,
}));
vi.mock("./render.js", () => ({ prepareShareRender: mocks.render }));
import { createShareService } from "./service.js";
const shared = {
  projectId: "project",
  url: "https://hyperframes.dev/review/link",
  access: "public",
  space: { id: "space" },
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.status.mockResolvedValue(null);
  mocks.record.mockResolvedValue(null);
  mocks.pending.mockResolvedValue(null);
  mocks.version.mockResolvedValue({ last: null, source: "ready" });
  mocks.project.mockResolvedValue({ latest_ready_version_id: "version-id" });
  mocks.flags.mockResolvedValue({ versionSharing: true });
  mocks.spaces.mockResolvedValue([
    {
      space_id: "space",
      bound: true,
      can_create_review: true,
      review_entitlements: {
        can_register_project: true,
        allowed_collaborative_access_modes: ["public"],
      },
    },
  ]);
});
describe("share operation consent and identity", () => {
  it("reads an existing link without rendering or creating a version", async () => {
    mocks.status.mockResolvedValue(shared);
    expect((await createShareService("/project").run({ action: "share" })).url).toBe(shared.url);
    expect(mocks.render).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.add).not.toHaveBeenCalled();
  });
  it("never chooses an audience for unattended first share", async () => {
    await expect(createShareService("/project").run({ action: "share" })).rejects.toMatchObject({
      code: "audience_required",
    });
    expect(mocks.render).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("checks free quota before rendering", async () => {
    mocks.spaces.mockResolvedValue([
      {
        space_id: "space",
        bound: true,
        can_create_review: true,
        review_entitlements: { can_register_project: false },
      },
    ]);
    await expect(
      createShareService("/project").run({ action: "share", audience: "public" }),
    ).rejects.toMatchObject({ reason: "review_project_limit_reached" });
    expect(mocks.render).not.toHaveBeenCalled();
  });
  it("preserves existing workspace and audience", async () => {
    mocks.status.mockResolvedValue(shared);
    const service = createShareService("/project");
    await expect(service.run({ action: "update", space: "other" })).rejects.toMatchObject({
      reason: "workspace_mismatch",
    });
    await expect(service.run({ action: "share", audience: "private" })).rejects.toMatchObject({
      reason: "manage_existing_audience",
    });
    expect(mocks.render).not.toHaveBeenCalled();
  });
  it("refuses a public share opened while a private first share was rendering", async () => {
    mocks.render.mockImplementation(async () => {
      mocks.create.mockResolvedValue(shared);
    });

    await expect(
      createShareService("/project").run({ action: "share", audience: "private" }),
    ).rejects.toMatchObject({ reason: "manage_existing_audience" });
    expect(mocks.add).not.toHaveBeenCalled();
  });
  it("refuses a first share bound to another workspace during rendering", async () => {
    mocks.render.mockImplementation(async () => {
      mocks.create.mockResolvedValue({ ...shared, space: { id: "other" } });
    });

    await expect(
      createShareService("/project").run({ action: "share", audience: "public", space: "space" }),
    ).rejects.toMatchObject({ reason: "workspace_mismatch" });
    expect(mocks.add).not.toHaveBeenCalled();
  });
  it("refuses an update when the folder changes review projects during rendering", async () => {
    mocks.status.mockResolvedValue(shared);
    mocks.render.mockImplementation(async () => {
      mocks.status.mockResolvedValue({ ...shared, projectId: "different-project" });
    });

    await expect(createShareService("/project").run({ action: "update" })).rejects.toMatchObject({
      reason: "review_binding_changed",
    });
    expect(mocks.add).not.toHaveBeenCalled();
  });
  it("refuses an update when access changes during rendering", async () => {
    mocks.status.mockResolvedValue({ ...shared, access: "private" });
    mocks.render.mockImplementation(async () => {
      mocks.status.mockResolvedValue(shared);
    });

    await expect(createShareService("/project").run({ action: "update" })).rejects.toMatchObject({
      reason: "manage_existing_audience",
    });
    expect(mocks.add).not.toHaveBeenCalled();
  });
  it("pins the approved project into a first upload", async () => {
    mocks.create.mockImplementation(async () => {
      mocks.status.mockResolvedValue(shared);
      return shared;
    });
    mocks.add.mockResolvedValue(null);

    await createShareService("/project").run({ action: "share", audience: "public" });

    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ spaceId: "space" }));
    expect(mocks.add).toHaveBeenCalledWith(expect.objectContaining({ projectId: "project" }));
  });
  it("retries an unfinished first share in its saved workspace", async () => {
    mocks.record.mockResolvedValue({ spaceId: "saved", projectId: "project" });
    mocks.spaces.mockResolvedValue([
      { space_id: "space", bound: true, can_create_review: true },
      { space_id: "saved", can_create_review: true },
    ]);
    mocks.create.mockImplementation(async () => {
      const saved = { ...shared, space: { id: "saved" }, access: "private" };
      mocks.status.mockResolvedValue(saved);
      return saved;
    });
    mocks.add.mockResolvedValue(null);
    const service = createShareService("/project");

    await expect(
      service.run({ action: "share", audience: "private", space: "space" }),
    ).rejects.toMatchObject({ reason: "workspace_mismatch" });
    expect(mocks.render).not.toHaveBeenCalled();
    await service.run({ action: "share", audience: "private" });
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ spaceId: "saved" }));
    expect(mocks.add).toHaveBeenCalledWith(expect.objectContaining({ projectId: "project" }));
  });
  it("does not report a different project's link if the folder changes during upload", async () => {
    mocks.status.mockResolvedValue(shared);
    mocks.add.mockImplementation(async () => {
      mocks.status.mockResolvedValue({ ...shared, projectId: "different-project" });
      return null;
    });

    await expect(createShareService("/project").run({ action: "update" })).rejects.toMatchObject({
      reason: "review_binding_changed",
    });
    expect(mocks.add).toHaveBeenCalledWith(expect.objectContaining({ projectId: "project" }));
  });
  it("does not label an old ready version as a completed update", async () => {
    mocks.status.mockResolvedValue(shared);
    mocks.add.mockResolvedValue(null);
    mocks.version.mockResolvedValue({ last: { current: false }, source: "ready" });
    const result = await createShareService("/project").run({ action: "update" });
    expect(result).toMatchObject({ state: "processing", ready: false, url: null });
  });
  it("reports rejection discovered after the upload watch ends", async () => {
    mocks.status.mockResolvedValue(shared);
    mocks.add.mockResolvedValue(null);
    mocks.refresh.mockResolvedValueOnce(undefined).mockImplementationOnce(async () => {
      mocks.version.mockResolvedValue({ last: null, source: "ready", failure: "Video rejected." });
    });

    await expect(createShareService("/project").run({ action: "update" })).rejects.toThrow(
      "Video rejected.",
    );
  });
  it("keeps the kernel's default source callback for a video-only update", async () => {
    mocks.status.mockResolvedValue(shared);
    mocks.flags.mockResolvedValue({ versionSharing: true, shareFiles: true });
    mocks.add.mockResolvedValue(null);

    const result = await createShareService("/project").run({ action: "update", videoOnly: true });

    expect(result.source).toEqual({ at: "video_only", reason: "requested" });
    expect(mocks.add).toHaveBeenCalledOnce();
    expect(mocks.add.mock.calls[0]?.[0]).not.toHaveProperty("filesForExport");
  });
  it("does not silently upload changed edits while resuming first share", async () => {
    mocks.status.mockResolvedValue(shared);
    mocks.project.mockResolvedValue({ latest_ready_version_id: null });
    mocks.version.mockResolvedValue({ last: null, source: "stale" });
    await expect(createShareService("/project").run({ action: "share" })).rejects.toThrow(
      "--update",
    );
    expect(mocks.render).not.toHaveBeenCalled();
    expect(mocks.add).not.toHaveBeenCalled();
  });
  it("keeps an off link off on repeat share", async () => {
    mocks.status.mockResolvedValue({ ...shared, url: null });
    expect((await createShareService("/project").run({ action: "share" })).state).toBe("link_off");
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe("asynchronous share recovery", () => {
  it("reconciles completion before reading project and local status", async () => {
    mocks.status.mockResolvedValue(shared);
    mocks.pending.mockResolvedValue({ projectId: "project", videoId: "video-id" });
    mocks.refresh.mockImplementation(async () => {
      mocks.pending.mockResolvedValue(null);
    });
    const result = await createShareService("/project").run({ action: "status" });
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.refresh.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.project.mock.invocationCallOrder[0] ?? 0,
    );
    expect(result).toMatchObject({ state: "ready", ready: true, url: shared.url });
    expect(mocks.add).not.toHaveBeenCalled();
    expect(mocks.render).not.toHaveBeenCalled();
  });
  it("keeps an active upload processing even if unrelated IDs happen to match", async () => {
    mocks.status.mockResolvedValue(shared);
    mocks.pending.mockResolvedValue({ projectId: "project", videoId: "version-id" });
    expect(await createShareService("/project").status()).toMatchObject({
      state: "processing",
      ready: false,
      url: null,
    });
  });
});
