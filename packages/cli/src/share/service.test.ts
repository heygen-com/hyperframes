import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./activity.js", () => ({
  readShareActivity: () => mocks.activity(),
  withShareActivity: async (_dir: string, run: (phase: () => Promise<void>) => Promise<unknown>) =>
    run(async () => {}),
}));
const mocks = vi.hoisted(() => ({
  source: vi.fn(),
  activity: vi.fn(),
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
  event: vi.fn(),
  access: vi.fn(),
  setAccess: vi.fn(),
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
  setReviewAccess: mocks.setAccess,
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
  createShareAccess: () => ({ access: mocks.access }),
  shareSite: () => "https://hyperframes.dev",
}));
vi.mock("./host.js", () => ({
  assertReviewUploadStorage: vi.fn(),
  bindCliShareProject: (path: string) => path,
}));
vi.mock("./sources.js", () => ({
  prepareCliShareSource: mocks.source,
  uncheckedSource: () => ({ at: "not_checked" }),
}));
vi.mock("./render.js", () => ({ prepareShareRender: mocks.render }));
vi.mock("../telemetry/client.js", () => ({
  trackEvent: mocks.event,
  resetTelemetryPostureCache: vi.fn(),
}));
vi.mock("../telemetry/config.js", () => ({ readConfigFresh: vi.fn() }));
import { createShareService } from "./service.js";
const shared = {
  projectId: "project",
  url: "https://hyperframes.dev/review/link",
  access: "public",
  space: { id: "space" },
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.activity.mockResolvedValue(null);
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
  it("preserves existing workspace and changes an explicitly requested audience", async () => {
    mocks.status.mockResolvedValue(shared);
    const service = createShareService("/project");
    await expect(service.run({ action: "update", space: "other" })).rejects.toMatchObject({
      reason: "workspace_mismatch",
    });
    mocks.setAccess.mockImplementation(async () =>
      mocks.status.mockResolvedValue({ ...shared, access: "private" }),
    );
    await service.run({ action: "share", audience: "private" });
    expect(mocks.setAccess).toHaveBeenCalledWith(
      expect.objectContaining({ change: { access: "private" } }),
    );
    expect(mocks.add).not.toHaveBeenCalled();
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
    expect(mocks.add).toHaveBeenCalledWith(expect.objectContaining({ omitSource: true }));
  });
  it("does not silently upload changed edits while resuming first share", async () => {
    mocks.status.mockResolvedValue(shared);
    mocks.project.mockResolvedValue({ latest_ready_version_id: null });
    mocks.version.mockResolvedValue({ last: null, source: "stale" });
    mocks.pending.mockResolvedValue({ projectId: "project", videoId: "upload" });
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
describe("share rollout signals", () => {
  const events = () => mocks.event.mock.calls.map(([name]) => name);
  it("records a completed video even when its review link is disabled", async () => {
    mocks.status.mockResolvedValue({ ...shared, url: null });
    mocks.add.mockImplementation(async (request) => request.onAdded());
    const result = await createShareService("/secret").run({ action: "update" });
    expect(result.state).toBe("link_off");
    expect(events()).toContain("share_video_ready");
    expect(events()).not.toContain("share_mutation_processing");
  });
  it("records the allowlisted missing-audience usage reason", async () => {
    await expect(createShareService("/secret").run({ action: "share" })).rejects.toMatchObject({
      code: "audience_required",
    });
    expect(mocks.event.mock.lastCall?.[1]).toMatchObject({ reason: "audience_required" });
  });
  it("records recovery before refreshing a completed pending upload clears its state", async () => {
    mocks.status.mockResolvedValue(shared);
    mocks.pending.mockResolvedValue({ projectId: "project", videoId: "pending" });
    mocks.refresh.mockImplementation(async () => mocks.pending.mockResolvedValue(null));
    await createShareService("/secret").run({ action: "share" });
    expect(events()).toContain("share_recovery_attempted");
    expect(mocks.event.mock.lastCall?.[1]).toMatchObject({ recovery: true });
    expect(events()).not.toContain("share_video_ready");
    expect(mocks.add).not.toHaveBeenCalled();
  });
  it("records only verified upload admission and ready, attributed to local Studio", async () => {
    mocks.status.mockResolvedValue(shared);
    mocks.add.mockImplementation(async (request) => {
      request.onProgress({ step: "preparing", sent: 0, total: 0 });
      request.onProgress({ step: "uploading", sent: 1, total: 2 });
      request.onProgress({ step: "processing", sent: 2, total: 2 });
      request.onAdded();
    });
    await createShareService("/private/project", undefined, { surface: "local_studio" }).run({
      action: "update",
    });
    expect(events()).toEqual([
      "share_mutation_attempted",
      "share_mutation_authenticated",
      "share_mutation_admitted",
      "share_video_ready",
    ]);
    expect(mocks.event.mock.calls.every(([, data]) => data.client_surface === "local_studio")).toBe(
      true,
    );
    expect(new Set(mocks.event.mock.calls.map(([, data]) => data.attempt_id)).size).toBe(1);
  });
  it("counts quota refusal without admission, rendering, or raw error details", async () => {
    mocks.spaces.mockResolvedValue([
      {
        space_id: "space",
        bound: true,
        can_create_review: true,
        review_entitlements: { can_register_project: false },
      },
    ]);
    await expect(
      createShareService("/secret").run({ action: "share", audience: "public" }),
    ).rejects.toBeDefined();
    expect(events()).toEqual([
      "share_mutation_attempted",
      "share_mutation_authenticated",
      "share_mutation_failed",
    ]);
    expect(mocks.event.mock.lastCall?.[1]).toMatchObject({
      reason: "review_project_limit_reached",
    });
    expect(mocks.render).not.toHaveBeenCalled();
  });
  it("records pending recovery without labeling the prior ready version new", async () => {
    mocks.status.mockResolvedValue(shared);
    mocks.pending.mockResolvedValue({ projectId: "project", videoId: "pending" });
    mocks.add.mockResolvedValue(null);
    mocks.version.mockResolvedValue({ last: { current: false }, source: "ready" });
    await createShareService("/secret").run({ action: "update" });
    expect(events()).toContain("share_recovery_attempted");
    expect(events()).toContain("share_mutation_processing");
    expect(events()).not.toContain("share_video_ready");
    expect(mocks.event.mock.lastCall?.[1]).toMatchObject({ recovery: true });
  });
  it("existing-link retrieval and polling never count as a new video or copied link", async () => {
    mocks.status.mockResolvedValue(shared);
    const service = createShareService("/secret");
    await service.run({ action: "status" });
    expect(events()).toEqual([]);
    await service.run({ action: "share" });
    expect(events()).toEqual([
      "share_mutation_attempted",
      "share_mutation_authenticated",
      "share_existing_link_returned",
    ]);
  });
  it("stops entry creation on authoritative rollback while keeping existing links readable", async () => {
    mocks.flags.mockResolvedValue({ versionSharing: false });
    await expect(
      createShareService("/secret").run({ action: "share", audience: "public" }),
    ).rejects.toMatchObject({ reason: "feature_unavailable" });
    expect(mocks.render).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    mocks.status.mockResolvedValue(shared);
    expect((await createShareService("/secret").run({ action: "share" })).ready).toBe(true);
  });
});

it("link reactivation cannot bypass the first-share rollout gate", async () => {
  mocks.flags.mockResolvedValue({ versionSharing: false });
  await expect(createShareService("/secret").linkOn()).rejects.toMatchObject({
    reason: "not_shared",
  });
  expect(mocks.create).not.toHaveBeenCalled();
});

it.each([null, "previous-version"])(
  "keeps a terminal failure separate from ready version %s",
  async (latest) => {
    mocks.status.mockResolvedValue(shared);
    mocks.project.mockResolvedValue({ latest_ready_version_id: latest });
    mocks.version.mockResolvedValue({
      last: null,
      source: "ready",
      failure: "This video can't be shared.",
    });
    const result = await createShareService("/project").run({ action: "status" });
    expect(result).toMatchObject({
      state: "failed",
      ready: false,
      url: null,
      previousUrl: latest ? shared.url : null,
    });
    expect(mocks.add).not.toHaveBeenCalled();
  },
);

it("retries an uncreated first version after refusal even when local files changed", async () => {
  mocks.status.mockResolvedValue(shared);
  mocks.project.mockResolvedValue({ latest_ready_version_id: null });
  mocks.version.mockResolvedValue({ last: null, source: "stale", failure: "Sharing blocked." });
  mocks.add.mockResolvedValue("Sharing blocked.");
  await expect(
    createShareService("/project").run({ action: "share", audience: "public" }),
  ).rejects.toThrow("Sharing blocked.");
  expect(mocks.render).toHaveBeenCalledOnce();
  expect(mocks.add).toHaveBeenCalledOnce();
  expect(mocks.create).not.toHaveBeenCalled();
});

it("reports an unchanged completed update without claiming a new version", async () => {
  mocks.status.mockResolvedValue(shared);
  mocks.version.mockResolvedValue({ last: { current: true }, source: "ready" });
  mocks.add.mockResolvedValue(null);
  const result = await createShareService("/project").run({ action: "update" });
  expect(result.upToDate).toBe(true);
});
it("propagates a refused audience change without rendering", async () => {
  mocks.status.mockResolvedValue(shared);
  mocks.setAccess.mockRejectedValue(new Error("Restricted sharing requires a subscription"));
  await expect(
    createShareService("/project").run({ action: "share", audience: "team" }),
  ).rejects.toThrow("subscription");
  expect(mocks.render).not.toHaveBeenCalled();
});

it("does not label a newly published version as already up to date", async () => {
  mocks.status.mockResolvedValue(shared);
  mocks.version.mockResolvedValue({ last: { current: true }, source: "ready" });
  mocks.add.mockImplementation(async ({ onAdded }) => {
    onAdded();
    return null;
  });
  expect(await createShareService("/project").run({ action: "update" })).toMatchObject({
    upToDate: false,
  });
});
it("does not label a still-processing update as already up to date", async () => {
  mocks.status.mockResolvedValue(shared);
  mocks.version.mockResolvedValue({ last: { current: true }, source: "ready" });
  mocks.pending.mockResolvedValue({ projectId: "project" });
  mocks.add.mockResolvedValue(null);
  expect(await createShareService("/project").run({ action: "update" })).toMatchObject({
    upToDate: false,
  });
});

it("does not claim to check freshness in status", async () => {
  mocks.status.mockResolvedValue(shared);
  expect(await createShareService("/project").run({ action: "status" })).not.toHaveProperty(
    "upToDate",
  );
});

it("reports local rendering instead of the previous ready version", async () => {
  mocks.status.mockResolvedValue(shared);
  mocks.activity.mockResolvedValue({ step: "rendering", startedAt: "2026-11-10T00:00:00Z" });
  const state = await createShareService("/project").run({ action: "status" });
  expect(state).toMatchObject({
    state: "rendering",
    ready: false,
    url: null,
    previousUrl: shared.url,
  });
  expect(mocks.render).not.toHaveBeenCalled();
});
it("reports the first share while it has no server project yet", async () => {
  mocks.activity.mockResolvedValue({ step: "uploading_source", startedAt: "2026-11-10T00:00:00Z" });
  expect(await createShareService("/project").run({ action: "status" })).toMatchObject({
    state: "uploading_source",
    ready: false,
    url: null,
  });
});

it.each([false, true])(
  "only prepares source after affirmative consent (%s)",
  async (includeSource) => {
    mocks.status.mockResolvedValue(shared);
    mocks.flags.mockResolvedValue({ versionSharing: true, shareFiles: true });
    mocks.source.mockResolvedValue({
      source: { at: "video_only", reason: "source_plan_required" },
      requireSource: false,
    });
    await createShareService("/project").run({ action: "update", includeSource });
    expect(mocks.source).toHaveBeenCalledTimes(includeSource ? 1 : 0);
  },
);
