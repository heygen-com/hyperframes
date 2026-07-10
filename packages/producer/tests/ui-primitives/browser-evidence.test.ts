import { describe, expect, it } from "bun:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

describe.serial("Operator Black browser evidence", () => {
  it("runs serialized evidence callbacks through the package tsx runtime", async () => {
    const child = Bun.spawn(["bunx", "tsx", resolve(here, "browser-evidence-tsx-smoke.ts")], {
      cwd: resolve(here, "../.."),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  }, 30_000);
});
