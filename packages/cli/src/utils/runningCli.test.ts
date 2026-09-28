import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { registerRunningCli } from "./runningCli.js";

let dir = "";
afterEach(() => rmSync(dir, { recursive: true, force: true }));

it("marks this process as running until it exits", () => {
  dir = mkdtempSync(join(tmpdir(), "hf-running-"));
  const before = process.listeners("exit");
  registerRunningCli(join(dir, "running"));
  const file = join(dir, "running", String(process.pid));
  expect(existsSync(file)).toBe(true);

  const added = process.listeners("exit").filter((listener) => !before.includes(listener));
  for (const listener of added) {
    listener(0);
    process.off("exit", listener);
  }
  expect(existsSync(file)).toBe(false);
});
