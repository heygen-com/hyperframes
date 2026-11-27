import * as fs from "node:fs";
import * as path from "node:path";
import { expect, it } from "vitest";
import { cleanupStudioServerRoot, makeStudioServerRoot } from "./studioServerTestFixture.js";

it("deletes the temp root only once the server has shut down and its history can no longer write there", async () => {
  const { root } = makeStudioServerRoot("hf-cleanup-order-");
  let finishShutdown!: () => void;
  const shutdown = new Promise<void>((resolve) => (finishShutdown = resolve));
  const cleaned = cleanupStudioServerRoot(
    { watcher: { close() {} }, shutdown: () => shutdown },
    root,
  );
  expect(fs.existsSync(root)).toBe(true);
  fs.mkdirSync(path.join(root, "history"));
  fs.writeFileSync(path.join(root, "history", "last-write.json"), "{}");
  finishShutdown();
  await cleaned;
  expect(fs.existsSync(root)).toBe(false);
});
