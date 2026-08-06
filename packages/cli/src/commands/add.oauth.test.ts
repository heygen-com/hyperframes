import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RegistryItem } from "@hyperframes/core";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  install: vi.fn(),
  resolve: vi.fn(),
  trackEvent: vi.fn(),
  shouldTrack: vi.fn(() => true),
  writePrimitiveFunnelContext: vi.fn(),
}));

vi.mock("../registry/threadMessageStackAuthorization.js", () => ({
  authorizeThreadMessageStackInstall: mocks.authorize,
}));
vi.mock("../registry/installer.js", () => ({ installItem: mocks.install }));
vi.mock("../telemetry/client.js", () => ({
  trackEvent: mocks.trackEvent,
  shouldTrack: mocks.shouldTrack,
}));
vi.mock("../telemetry/config.js", () => ({
  readConfig: () => ({ anonymousId: "anonymous-direct-add" }),
}));
vi.mock("../telemetry/primitive-funnel-state.js", () => ({
  writePrimitiveFunnelContext: mocks.writePrimitiveFunnelContext,
}));
vi.mock("../registry/resolver.js", () => ({
  resolveItemWithDependencies: mocks.resolve,
  resolveItemsByTag: vi.fn(async () => []),
}));

import { runAdd } from "./add.js";

const item: RegistryItem = {
  name: "thread-message-stack",
  type: "hyperframes:block",
  title: "Thread Message Stack",
  description: "Conversation",
  dimensions: { width: 1920, height: 1080 },
  duration: 8,
  files: [
    {
      path: "thread-message-stack.html",
      target: "compositions/thread-message-stack.html",
      type: "hyperframes:composition",
    },
  ],
};

describe("direct add thread-message-stack OAuth boundary", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "hf-add-oauth-"));
    mocks.resolve.mockReset().mockResolvedValue([item]);
    mocks.install.mockReset().mockResolvedValue({ written: [join(projectDir, "stack.html")] });
    mocks.authorize.mockReset();
    mocks.trackEvent.mockReset();
    mocks.shouldTrack.mockReset().mockReturnValue(true);
    mocks.writePrimitiveFunnelContext.mockReset();
  });

  afterEach(() => rmSync(projectDir, { recursive: true, force: true }));

  it.each(["api-key-only", "cancelled", "failed"] as const)(
    "does not download or materialize when verified HeyGen OAuth is %s",
    async (outcome) => {
      mocks.authorize.mockImplementation(async (deps) => {
        deps.onAuthStarted?.();
        return outcome;
      });

      await expect(
        runAdd({ name: "thread-message-stack", projectDir, skipClipboard: true }),
      ).rejects.toMatchObject({ code: "oauth-required" });
      expect(mocks.authorize).toHaveBeenCalledTimes(1);
      expect(mocks.resolve).not.toHaveBeenCalled();
      expect(mocks.install).not.toHaveBeenCalled();
      expect(mocks.trackEvent.mock.calls.map(([name]) => name)).toEqual([
        "primitive_auth_started",
        "primitive_auth_failed",
      ]);
      expect(mocks.writePrimitiveFunnelContext).not.toHaveBeenCalled();
    },
  );

  it("downloads and materializes exactly once after verified HeyGen OAuth succeeds", async () => {
    mocks.authorize.mockImplementation(async (deps) => {
      deps.onAuthStarted?.();
      deps.onVerified?.({ email: "verified@example.com" }, "oauth");
      return "authorized";
    });
    mocks.install.mockImplementationOnce(async () => {
      expect(mocks.trackEvent.mock.calls.map(([name]) => name)).toEqual([
        "primitive_auth_started",
        "$identify",
        "primitive_auth_completed",
        "primitive_install_started",
      ]);
      return { written: [join(projectDir, "stack.html")] };
    });

    await expect(
      runAdd({ name: "thread-message-stack", projectDir, skipClipboard: true }),
    ).resolves.toMatchObject({ ok: true, name: "thread-message-stack" });
    expect(mocks.authorize).toHaveBeenCalledTimes(1);
    expect(mocks.install).toHaveBeenCalledTimes(1);
    expect(mocks.writePrimitiveFunnelContext).toHaveBeenCalledTimes(1);
    const persisted = mocks.writePrimitiveFunnelContext.mock.calls[0]?.[1];
    expect(persisted).toMatchObject({
      primitiveId: "thread-message-stack",
      artifactId: expect.any(String),
      versionId: expect.any(String),
      catalogVersion: expect.any(String),
      funnelId: expect.any(String),
      installId: expect.any(String),
    });
    expect(mocks.trackEvent.mock.calls.map(([name]) => name)).toEqual([
      "primitive_auth_started",
      "$identify",
      "primitive_auth_completed",
      "primitive_install_started",
      "primitive_install_completed",
    ]);
    const installEvents = mocks.trackEvent.mock.calls.filter(([name]) =>
      String(name).startsWith("primitive_install_"),
    );
    expect(installEvents[0]?.[1].funnel_id).toBe(installEvents[1]?.[1].funnel_id);
    expect(installEvents[1]?.[1]).toMatchObject({
      duration_ms: expect.any(Number),
      event_id: `${persisted.installId}:install-completed`,
    });
  });
});
