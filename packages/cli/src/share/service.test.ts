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
}));
vi.mock("@hyperframes/share", () => ({
  reviewClient: () => ({ project: mocks.project, spaces: mocks.spaces, reviewFlags: mocks.flags }),
  reviewStatus: mocks.status,
  reviewVersion: mocks.version,
  reviewRecord: mocks.record,
  shareForReview: mocks.create,
  addVersion: mocks.add,
  pendingReviewExport: mocks.pending,
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
vi.mock("./host.js", () => ({ bindCliShareProject: (path: string) => path }));
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
  mocks.project.mockResolvedValue({ latest_ready_version_id: "video" });
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
      reason: "audience_required",
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
  it("does not label an old ready version as a completed update", async () => {
    mocks.status.mockResolvedValue(shared);
    mocks.add.mockResolvedValue(null);
    mocks.version.mockResolvedValue({ last: { current: false }, source: "ready" });
    const result = await createShareService("/project").run({ action: "update" });
    expect(result).toMatchObject({ state: "processing", ready: false, url: null });
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
