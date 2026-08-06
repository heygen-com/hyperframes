import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RegistryItem } from "@hyperframes/core";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  install: vi.fn(),
  resolve: vi.fn(),
}));

vi.mock("../registry/threadMessageStackAuthorization.js", () => ({
  authorizeThreadMessageStackInstall: mocks.authorize,
}));
vi.mock("../registry/installer.js", () => ({ installItem: mocks.install }));
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
  });

  afterEach(() => rmSync(projectDir, { recursive: true, force: true }));

  it.each(["api-key-only", "cancelled", "failed"] as const)(
    "does not download or materialize when verified HeyGen OAuth is %s",
    async (outcome) => {
      mocks.authorize.mockResolvedValue(outcome);

      await expect(
        runAdd({ name: "thread-message-stack", projectDir, skipClipboard: true }),
      ).rejects.toMatchObject({ code: "oauth-required" });
      expect(mocks.authorize).toHaveBeenCalledTimes(1);
      expect(mocks.resolve).not.toHaveBeenCalled();
      expect(mocks.install).not.toHaveBeenCalled();
    },
  );

  it("downloads and materializes exactly once after verified HeyGen OAuth succeeds", async () => {
    mocks.authorize.mockResolvedValue("authorized");

    await expect(
      runAdd({ name: "thread-message-stack", projectDir, skipClipboard: true }),
    ).resolves.toMatchObject({ ok: true, name: "thread-message-stack" });
    expect(mocks.authorize).toHaveBeenCalledTimes(1);
    expect(mocks.install).toHaveBeenCalledTimes(1);
  });
});
