import { describe, expect, it, onTestFinished } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const cliEntry = resolve(fileURLToPath(import.meta.url), "..", "..", "..", "cli.ts");

const page = (body: string) =>
  `<!doctype html><html><body><div data-composition-id="main" data-width="1920" data-height="1080">${body}</div></body></html>`;

/** A project whose index.html and alternate.html do not mount each other. */
function project(index: string, alternate: string): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-cloud-missing-entry-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "index.html"), page(index));
  writeFileSync(join(dir, "alternate.html"), page(alternate));
  return dir;
}

function dryRunAlternate(dir: string) {
  return spawnSync(
    "bun",
    [
      "run",
      cliEntry,
      "cloud",
      "render",
      dir,
      "--composition",
      "alternate.html",
      "--dry-run",
      "--json",
    ],
    {
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
    },
  );
}

const MISSING = 'The composition references "missing.png", which is not in the project folder.';

describe("cloud render --composition checks missing files from the page it renders", () => {
  it("refuses a missing image on the selected page", () => {
    const result = dryRunAlternate(project("", `<img src="missing.png">`));
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain(MISSING);
  });

  it("allows a missing image on an index.html the selected page does not play", () => {
    const result = dryRunAlternate(project(`<img src="missing.png">`, ""));
    expect(result.stdout + result.stderr).not.toContain(MISSING);
    expect(result.status).toBe(0);
  });
});
