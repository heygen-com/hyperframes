import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ enqueue: vi.fn() }));
vi.mock("../telemetry/transport.js", () => ({
  enqueue: mocks.enqueue,
  flush: vi.fn(),
  flushSync: vi.fn(),
}));
vi.mock("../utils/env.js", () => ({ isDevMode: () => false }));
vi.mock("../telemetry/system.js", () => ({ getSystemMeta: () => ({}) }));
vi.mock("../telemetry/canary.js", () => ({ canaryEventProperties: () => ({}) }));
vi.mock("../telemetry/signedInUser.js", () => ({ signedInHeygenUsername: () => undefined }));
import { observeShareMutation, trackShareInteraction } from "./telemetry.js";

let folder: string;
function preference(enabled: boolean) {
  writeFileSync(
    join(folder, "config.json"),
    JSON.stringify({ anonymousId: "test", bucketSeed: "test", telemetryEnabled: enabled }),
  );
}
beforeEach(() => {
  mocks.enqueue.mockClear();
  folder = mkdtempSync(join(tmpdir(), "hf-share-opt-out-"));
  vi.stubEnv("HYPERFRAMES_CONFIG_DIR", folder);
  vi.stubEnv("HYPERFRAMES_NO_TELEMETRY", "");
  vi.stubEnv("DO_NOT_TRACK", "");
  preference(true);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(folder, { recursive: true, force: true });
});

it("stops queueing events after a separate process changes the persisted preference", async () => {
  trackShareInteraction({ event: "share_opened", link: "none" }, "local_studio");
  expect(mocks.enqueue).toHaveBeenCalledOnce();
  preference(false);
  mocks.enqueue.mockClear();
  trackShareInteraction({ event: "share_link_copied", via: "copy" }, "local_studio");
  await observeShareMutation("update", "local_studio", async (attempt) => {
    attempt.authenticated();
    attempt.complete(true, true);
  });
  expect(mocks.enqueue).not.toHaveBeenCalled();
});

it.each(["HYPERFRAMES_NO_TELEMETRY", "DO_NOT_TRACK"])(
  "honors %s even after a previous event enabled the client cache",
  async (name) => {
    trackShareInteraction({ event: "share_opened", link: "none" });
    expect(mocks.enqueue).toHaveBeenCalledOnce();
    vi.stubEnv(name, "1");
    mocks.enqueue.mockClear();
    await observeShareMutation("share", "cli", async (attempt) => attempt.complete(true, true));
    expect(mocks.enqueue).not.toHaveBeenCalled();
  },
);
