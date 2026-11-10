import { beforeEach, expect, it, vi } from "vitest";
vi.mock("./activity.js", () => ({
  readShareActivity: async () => null,
  withShareActivity: async (_dir: string, run: (phase: () => Promise<void>) => Promise<unknown>) =>
    run(async () => {}),
}));
const mocks = vi.hoisted(() => ({
  token: "first",
  owner: "first-owner",
  register: vi.fn(),
  add: vi.fn(),
  render: vi.fn(),
}));
vi.mock("../auth/resolver.js", () => ({
  resolveCredential: async () => ({ type: "oauth", access_token: mocks.token, refreshable: false }),
}));
vi.mock("../auth/client.js", () => ({
  apiBaseUrl: () => "https://api.heygen.com",
  AuthClient: class {
    getCurrentUser = async () => ({ username: mocks.owner });
  },
}));
vi.mock("./host.js", () => ({
  bindCliShareProject: (path: string) => path,
  assertReviewUploadStorage: () => {},
}));
vi.mock("./render.js", () => ({ prepareShareRender: mocks.render }));
vi.mock("../telemetry/client.js", () => ({ trackEvent: vi.fn() }));
vi.mock("@hyperframes/share", async (original) => {
  const actual = await original<typeof import("@hyperframes/share")>();
  return {
    ...actual,
    reviewClient: ({ access }: { access: () => Promise<unknown> }) => ({
      access,
      reviewFlags: async () => ({ versionSharing: true, shareFiles: false }),
      spaces: async () => [
        {
          space_id: "space",
          bound: true,
          can_create_review: true,
          review_entitlements: {
            can_register_project: true,
            allowed_collaborative_access_modes: ["public"],
          },
        },
      ],
      project: async () => ({ latest_ready_version_id: "version" }),
    }),
    reviewStatus: async () => null,
    reviewRecord: async () => null,
    reviewVersion: async () => ({ last: null, source: "ready", failure: null }),
    pendingReviewExport: async () => null,
    refreshReviewExport: async () => {},
    shareForReview: async ({ client }: { client: { access: () => Promise<unknown> } }) => {
      await client.access();
      mocks.register();
      return { projectId: "project", space: { id: "space" }, access: "public" };
    },
    addVersion: mocks.add,
  };
});
import { createShareService } from "./service.js";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.token = "first";
  mocks.owner = "first-owner";
});
it("does not register or upload as a different account after rendering", async () => {
  mocks.render.mockImplementation(async () => {
    mocks.token = "second";
    mocks.owner = "second-owner";
  });
  await expect(
    createShareService("/project").run({ action: "share", audience: "public" }),
  ).rejects.toMatchObject({ code: "LOGIN_CHANGED" });
  expect(mocks.register).not.toHaveBeenCalled();
  expect(mocks.add).not.toHaveBeenCalled();
});
