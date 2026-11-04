import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { ProjectLockTimeout, projectLockPath, withProjectLock } from "./projectLock.js";

vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof fs>();
  return { ...original, linkSync: vi.fn(original.linkSync) };
});

const directories: string[] = [];
const project = () => {
  const directory = mkdtempSync(join(tmpdir(), "hf-project-lock-"));
  directories.push(directory);
  return directory;
};
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
const locked = (waitMs: number) => ({ projectLock: { waitMs } });
const hold = (dir: string, pid: number) => {
  mkdirSync(dirname(projectLockPath(dir)), { recursive: true });
  writeFileSync(projectLockPath(dir), JSON.stringify({ pid, command: "check", startedAt: 1 }));
};

describe("withProjectLock", () => {
  it("runs without a lock file when the capability is absent", async () => {
    const dir = project();
    expect(
      await withProjectLock(dir, "check", async () => existsSync(projectLockPath(dir)), {}),
    ).toBe(false);
  });

  it("holds the lock while running and releases it afterwards, even on failure", async () => {
    const dir = project();
    const seen = await withProjectLock(
      dir,
      "snapshot",
      async () => JSON.parse(readFileSync(projectLockPath(dir), "utf8")),
      locked(0),
    );
    expect(seen).toMatchObject({ pid: process.pid, command: "snapshot" });
    expect(existsSync(projectLockPath(dir))).toBe(false);
    await expect(
      withProjectLock(dir, "check", async () => Promise.reject(new Error("boom")), locked(0)),
    ).rejects.toThrow("boom");
    expect(existsSync(projectLockPath(dir))).toBe(false);
  });

  it("takes the lock where hard links are refused (EPERM)", async () => {
    const dir = project();
    vi.mocked(fs.linkSync).mockImplementationOnce(() => {
      throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
    });
    const seen = await withProjectLock(
      dir,
      "check",
      async () => JSON.parse(readFileSync(projectLockPath(dir), "utf8")),
      locked(0),
    );
    expect(seen).toMatchObject({ pid: process.pid, command: "check" });
    expect(existsSync(projectLockPath(dir))).toBe(false);
  });

  it("serializes concurrent holders in one project", async () => {
    const dir = project();
    const order: string[] = [];
    const task = (name: string) =>
      withProjectLock(
        dir,
        name,
        async () => {
          order.push(`${name}:start`);
          await new Promise((done) => setTimeout(done, 50));
          order.push(`${name}:end`);
        },
        locked(5000),
      );
    await Promise.all([task("check"), task("snapshot")]);
    expect(order).toEqual(["check:start", "check:end", "snapshot:start", "snapshot:end"]);
  });

  it("waits up to waitMs for a live holder, then refuses with who holds it", async () => {
    const dir = project();
    hold(dir, process.pid);
    const started = Date.now();
    await expect(withProjectLock(dir, "snapshot", async () => "ran", locked(300))).rejects.toThrow(
      ProjectLockTimeout,
    );
    expect(Date.now() - started).toBeGreaterThanOrEqual(300);
    await expect(withProjectLock(dir, "snapshot", async () => "ran", locked(0))).rejects.toThrow(
      `hyperframes check (pid ${process.pid}) is still using this project`,
    );
  });

  it("takes over a lock whose process has exited", async () => {
    const dir = project();
    hold(dir, 2 ** 22 + 12345);
    expect(await withProjectLock(dir, "check", async () => "ran", locked(0))).toBe("ran");
  });

  it("serializes processes that concurrently take over a dead holder", async () => {
    const dir = project();
    const events = join(dir, "events.ndjson");
    hold(dir, 2 ** 22 + 12345);
    const moduleUrl = pathToFileURL(join(import.meta.dirname, "projectLock.ts")).href;
    const source = `
      import { appendFileSync } from "node:fs";
      import { withProjectLock } from ${JSON.stringify(moduleUrl)};
      await withProjectLock(
        ${JSON.stringify(dir)},
        "check",
        async () => {
          appendFileSync(${JSON.stringify(events)}, JSON.stringify({ type: "start", pid: process.pid }) + "\\n");
          await new Promise((done) => setTimeout(done, 50));
          appendFileSync(${JSON.stringify(events)}, JSON.stringify({ type: "end", pid: process.pid }) + "\\n");
        },
        { projectLock: { waitMs: 5000 } },
      );
    `;
    const children = Array.from({ length: 6 }, () =>
      spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", source], {
        stdio: ["ignore", "ignore", "pipe"],
      }),
    );
    const outcomes = await Promise.all(
      children.map(
        (child) =>
          new Promise<{ code: number | null; error: string }>((resolve) => {
            let error = "";
            child.stderr.on("data", (chunk) => (error += String(chunk)));
            child.on("close", (code) => resolve({ code, error }));
          }),
      ),
    );
    expect(outcomes).toEqual(outcomes.map(() => ({ code: 0, error: "" })));
    const records = readFileSync(events, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: "start" | "end"; pid: number });
    let active = 0;
    for (const record of records) {
      active += record.type === "start" ? 1 : -1;
      expect(active).toBeLessThanOrEqual(1);
    }
    expect(active).toBe(0);
  });

  it("refuses a breaker left by a killed process and names the file", async () => {
    const dir = project();
    hold(dir, 2 ** 22 + 12345);
    const breakPath = `${projectLockPath(dir)}.break`;
    const source = `
      import { linkSync, writeFileSync } from "node:fs";
      const holder = { pid: process.pid, command: "check", startedAt: 1 };
      const draft = ${JSON.stringify(`${breakPath}.killed`)};
      writeFileSync(draft, JSON.stringify(holder), { flag: "wx" });
      linkSync(draft, ${JSON.stringify(breakPath)});
      process.kill(process.pid, "SIGKILL");
    `;
    const child = spawn(process.execPath, ["--input-type=module", "--eval", source], {
      stdio: "ignore",
    });
    const outcome = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        child.on("close", (code, signal) => resolve({ code, signal }));
      },
    );
    expect(outcome.signal === "SIGKILL" || outcome.code !== 0).toBe(true);
    expect(existsSync(breakPath)).toBe(true);
    await expect(withProjectLock(dir, "check", async () => "ran", locked(0))).rejects.toThrow(
      `hyperframes left ${breakPath} (pid ${child.pid}); delete it to continue`,
    );
    expect(existsSync(breakPath)).toBe(true);
    expect(existsSync(projectLockPath(dir))).toBe(true);
  });
});
