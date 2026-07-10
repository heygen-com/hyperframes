import { afterAll, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const artifactsDir = await mkdtemp(resolve(tmpdir(), "operator-black-runner-"));

afterAll(async () => {
  await rm(artifactsDir, { recursive: true, force: true });
});

describe.serial("Operator Black scoped browser runner", () => {
  it("captures three sequential and one shuffled button pass from fresh state", async () => {
    const child = Bun.spawn(
      [
        "bunx",
        "tsx",
        resolve(here, "runner.ts"),
        "--only",
        "button",
        "--artifacts-dir",
        artifactsDir,
        "--json",
      ],
      { cwd: resolve(here, "../.."), stderr: "pipe", stdout: "pipe" },
    );
    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    const report: unknown = JSON.parse(
      await readFile(resolve(artifactsDir, "verification-report.json"), "utf8"),
    );

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(report).toMatchObject({
      failures: [],
      hashes: {
        expected: 7,
        matching: true,
        passes: [
          { name: "sequential-1", order: "sequential" },
          { name: "sequential-2", order: "sequential" },
          { name: "sequential-3", order: "sequential" },
          { name: "shuffled-1", order: "shuffled" },
        ],
      },
    });
  }, 30_000);
});
