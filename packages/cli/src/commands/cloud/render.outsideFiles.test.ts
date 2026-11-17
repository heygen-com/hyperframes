import { describe, expect, it, onTestFinished } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const cliEntry = resolve(fileURLToPath(import.meta.url), "..", "..", "..", "cli.ts");

/** `<root>/p`, whose page shows `<root>/shared/logo.png`. */
function projectWithOutsideImage(): string {
  const root = mkdtempSync(join(tmpdir(), "hf-cloud-outside-"));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "p");
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(root, "shared"));
  writeFileSync(join(root, "shared", "logo.png"), "png");
  writeFileSync(
    join(dir, "index.html"),
    `<!doctype html><html><body><div data-composition-id="main" data-width="1920" data-height="1080"><img src="../shared/logo.png"></div></body></html>`,
  );
  return dir;
}

function dryRun(dir: string, json: boolean, include = true) {
  const flags = [...(json ? ["--json"] : []), ...(include ? ["--include-outside-files"] : [])];
  return spawnSync("bun", ["run", cliEntry, "cloud", "render", dir, "--dry-run", ...flags], {
    encoding: "utf-8",
    timeout: 30_000,
    env: {
      ...process.env,
      CI: "1",
      HEYGEN_API_URL: "http://127.0.0.1:1",
      HYPERFRAMES_NO_UPDATE_CHECK: "1",
      HYPERFRAMES_NO_TELEMETRY: "1",
      HOME: dir,
    },
  });
}

const expected = {
  file: "index.html",
  reference: "../shared/logo.png",
  path: "../shared/logo.png",
  levels_up: 1,
};

describe("cloud render --dry-run without approval leaves out files from outside the project", () => {
  it("and names each one with how to include it, in --json and in print", () => {
    const json = dryRun(projectWithOutsideImage(), true, false);
    expect(json.status).toBe(0);
    const { archive } = JSON.parse(json.stdout) as { archive: { outside_files: unknown[] } };
    expect(archive.outside_files).toEqual([]);
    const events = json.stderr
      .split("\n")
      .filter((line) => line.startsWith('{"event":"left_out"'))
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events).toEqual([{ event: "left_out", ...expected, reason: "not_approved" }]);

    const printed = dryRun(projectWithOutsideImage(), false, false);
    expect(printed.status).toBe(0);
    expect(printed.stdout).toContain("index.html references ../shared/logo.png");
    expect(printed.stdout).toContain("Pass --include-outside-files to upload it.");
    expect(printed.stdout).not.toContain("Uploading 1 file from outside");
  });
});

describe("cloud render --dry-run --include-outside-files names each file it uploads from outside the project", () => {
  it("in its --json result, and as an outside_file event per file on stderr", () => {
    const result = dryRun(projectWithOutsideImage(), true);
    expect(result.status).toBe(0);
    const { archive } = JSON.parse(result.stdout) as { archive: { outside_files: unknown[] } };
    expect(archive.outside_files).toEqual([expected]);
    const events = result.stderr
      .split("\n")
      .filter((line) => line.startsWith('{"event":"outside_file"'))
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events).toEqual([{ event: "outside_file", ...expected }]);
  });

  it("in its printed output", () => {
    const result = dryRun(projectWithOutsideImage(), false);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Uploading 1 file from outside the project folder:");
    expect(result.stdout).toContain("../shared/logo.png (referenced by index.html)");
  });
});
