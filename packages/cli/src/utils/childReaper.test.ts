import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { testProcessIsAlive, waitForTestCondition } from "./processTestUtils.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, "childReaper.fixture.ts");
const leftovers: number[] = [];
let parent: ChildProcess | undefined;

afterEach(() => {
  parent?.kill("SIGKILL");
  for (const pid of leftovers.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
});

describe.skipIf(process.platform === "win32")("a CLI killed outright", () => {
  it("takes every process it started with it, a child stuck in synchronous work included", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hyperframes-child-reaper-"));
    const readyPath = join(dir, "ready");
    try {
      parent = spawn(process.execPath, ["--import", "tsx", fixturePath, readyPath], {
        stdio: "ignore",
      });
      await waitForTestCondition(() => existsSync(`${readyPath}.child`), 15_000);
      await waitForTestCondition(
        () => readFileSync(`${readyPath}.child`, "utf8").endsWith("}"),
        5_000,
      );
      const { child, grandchild } = JSON.parse(readFileSync(`${readyPath}.child`, "utf8")) as {
        child: number;
        grandchild: number;
      };
      leftovers.push(child, grandchild);
      expect([child, grandchild].every(testProcessIsAlive)).toBe(true);

      parent.kill("SIGKILL");

      await waitForTestCondition(() => ![child, grandchild].some(testProcessIsAlive), 5_000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe.skipIf(process.platform !== "win32")(
  "a Windows CLI that ends with children still held",
  () => {
    // fails without the fix: the reaper ran taskkill /T on each held pid whatever now held it, so a pid Windows had
    // given to another program was ended with its whole tree.
    it("ends the child it started and leaves a pid that now runs another program", async () => {
      const dir = mkdtempSync(join(tmpdir(), "hyperframes-child-reaper-image-"));
      const readyPath = join(dir, "ready");
      try {
        parent = spawn(
          process.execPath,
          ["--import", "tsx", join(here, "childReaper.image.fixture.ts"), readyPath],
          { stdio: "ignore" },
        );
        await new Promise((resolve) => parent!.once("exit", resolve));
        const { own, reused } = JSON.parse(readFileSync(readyPath, "utf8")) as {
          own: number;
          reused: number;
        };
        leftovers.push(own, reused);
        await waitForTestCondition(() => !testProcessIsAlive(own), 10_000);
        expect(testProcessIsAlive(reused)).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  },
);
