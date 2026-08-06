import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  tryResolveCredential: vi.fn(),
  tryResolveOAuthCredential: vi.fn(),
  startAuthorizationCodeFlow: vi.fn(),
  getCurrentUser: vi.fn(),
  runAdd: vi.fn(),
  trackEvent: vi.fn(),
  shouldTrack: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  select: mocks.select,
  isCancel: () => false,
  cancel: vi.fn(),
}));
vi.mock("../auth/index.js", () => ({
  tryResolveCredential: mocks.tryResolveCredential,
  tryResolveOAuthCredential: mocks.tryResolveOAuthCredential,
  startAuthorizationCodeFlow: mocks.startAuthorizationCodeFlow,
  AuthClient: class {
    getCurrentUser = mocks.getCurrentUser;
  },
}));
vi.mock("./add.js", () => ({ runAdd: mocks.runAdd }));
vi.mock("../telemetry/client.js", () => ({
  trackEvent: mocks.trackEvent,
  shouldTrack: mocks.shouldTrack,
}));
vi.mock("../telemetry/config.js", () => ({
  readConfig: () => ({ anonymousId: "anonymous-test-id" }),
}));
vi.mock("../registry/resolver.js", () => ({
  listRegistryItems: vi.fn(async () => [
    { name: "thread-message-stack", type: "hyperframes:block" },
  ]),
  loadAllItems: vi.fn(async () => [
    {
      name: "thread-message-stack",
      type: "hyperframes:block",
      title: "Thread Message Stack",
      description: "Conversation",
      tags: [],
      dimensions: { width: 1920, height: 1080 },
      duration: 8,
      files: [],
    },
  ]),
}));
vi.mock("../telemetry/primitive-funnel-state.js", () => ({
  writePrimitiveFunnelContext: vi.fn(),
}));
vi.mock("./catalog-resume.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./catalog-resume.js")>();
  return {
    ...actual,
    createFilePrimitiveInstallStateStore: vi.fn(() => ({})),
    resumePrimitiveInstallExactlyOnce: vi.fn(async (_intent, deps) => {
      if (!(await deps.isAuthenticated())) {
        const outcome = await deps.authenticate();
        if (outcome !== true) return outcome;
      }
      await deps.install(_intent);
      return "installed";
    }),
  };
});

import catalogCommand from "./catalog.js";

describe("interactive catalog verified OAuth boundary", () => {
  beforeEach(() => {
    mocks.select.mockReset().mockResolvedValue("thread-message-stack");
    mocks.tryResolveCredential.mockReset().mockResolvedValue({ type: "api_key", key: "key" });
    mocks.tryResolveOAuthCredential.mockReset().mockResolvedValue(null);
    mocks.startAuthorizationCodeFlow.mockReset().mockResolvedValue(undefined);
    mocks.getCurrentUser.mockReset().mockResolvedValue({ email: "verified@example.com" });
    mocks.trackEvent.mockReset();
    mocks.shouldTrack.mockReset().mockReturnValue(true);
    mocks.runAdd.mockReset().mockResolvedValue({
      ok: true,
      name: "thread-message-stack",
      type: "hyperframes:block",
      written: [],
      warnings: [],
      snippet: "",
    });
  });

  it("does not let an API key suppress HeyGen OAuth before catalog install", async () => {
    mocks.tryResolveOAuthCredential.mockResolvedValueOnce(null).mockResolvedValue({
      type: "oauth",
      access_token: "oauth-token",
      source: "file_json",
      refreshable: false,
    });

    await catalogCommand.run!({
      args: { "human-friendly": true },
      rawArgs: [],
      cmd: catalogCommand,
    } as never);

    expect(mocks.startAuthorizationCodeFlow).toHaveBeenCalledTimes(1);
    expect(mocks.getCurrentUser).toHaveBeenCalledWith(expect.objectContaining({ type: "oauth" }));
    expect(mocks.runAdd).toHaveBeenCalledTimes(1);
  });

  it("stitches an already verified OAuth session exactly once before install", async () => {
    mocks.tryResolveOAuthCredential.mockResolvedValue({
      type: "oauth",
      access_token: "existing-oauth-token",
      source: "file_json",
      refreshable: false,
    });
    mocks.runAdd.mockImplementationOnce(async () => {
      const identify = mocks.trackEvent.mock.calls.filter(([name]) => name === "$identify");
      const authCompleted = mocks.trackEvent.mock.calls.filter(
        ([name]) => name === "primitive_auth_completed",
      );
      expect(identify).toHaveLength(1);
      expect(authCompleted).toHaveLength(1);
      expect(identify[0]?.[1].funnel_id).toBe(authCompleted[0]?.[1].funnel_id);
      return {
        ok: true,
        name: "thread-message-stack",
        type: "hyperframes:block",
        written: [],
        warnings: [],
        snippet: "",
      };
    });

    await catalogCommand.run!({
      args: { "human-friendly": true },
      rawArgs: [],
      cmd: catalogCommand,
    } as never);

    expect(mocks.startAuthorizationCodeFlow).not.toHaveBeenCalled();
    expect(mocks.trackEvent.mock.calls.filter(([name]) => name === "$identify")).toHaveLength(1);
    expect(
      mocks.trackEvent.mock.calls.filter(([name]) => name === "primitive_auth_completed"),
    ).toHaveLength(1);
    expect(mocks.runAdd).toHaveBeenCalledTimes(1);
  });

  it("emits no identity or auth-completed events when opted out", async () => {
    mocks.shouldTrack.mockReturnValue(false);
    mocks.tryResolveOAuthCredential.mockResolvedValue({
      type: "oauth",
      access_token: "existing-oauth-token",
      source: "file_json",
      refreshable: false,
    });

    await catalogCommand.run!({
      args: { "human-friendly": true },
      rawArgs: [],
      cmd: catalogCommand,
    } as never);

    expect(mocks.startAuthorizationCodeFlow).not.toHaveBeenCalled();
    expect(mocks.trackEvent).not.toHaveBeenCalled();
    expect(mocks.runAdd).toHaveBeenCalledTimes(1);
  });
});
