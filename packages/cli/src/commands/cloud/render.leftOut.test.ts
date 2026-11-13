import { describe, expect, it, onTestFinished } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const cliEntry = resolve(fileURLToPath(import.meta.url), "..", "..", "..", "cli.ts");

/** `<root>/p` whose received index.html points at `<root>/notes.txt`; its own page points at `<root>/.env` and `<root>/data.json`. */
function importedProject(): string {
  const root = mkdtempSync(join(tmpdir(), "hf-cloud-left-out-"));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "p");
  mkdirSync(join(dir, ".hyperframes"), { recursive: true });
  writeFileSync(join(root, "notes.txt"), "outside");
  writeFileSync(join(root, ".env"), "SECRET=1");
  writeFileSync(join(root, "data.json"), "{}");
  writeFileSync(
    join(dir, "index.html"),
    `<!doctype html><html><body><div data-composition-id="main" data-width="1920" data-height="1080"><link href="../notes.txt"></div></body></html>`,
  );
  writeFileSync(join(dir, "mine.html"), `<link href="../.env"><link href="../data.json">`);
  writeFileSync(
    join(dir, ".hyperframes", "received-files.json"),
    JSON.stringify({ files: ["index.html"] }),
  );
  return dir;
}

describe("cloud render --dry-run --json lists what the upload leaves out", () => {
  it("in its result, and as a left_out event per file on stderr", () => {
    const dir = importedProject();
    const result = spawnSync(
      "bun",
      ["run", cliEntry, "cloud", "render", dir, "--dry-run", "--json"],
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

    expect(result.status).toBe(0);
    const { archive } = JSON.parse(result.stdout) as { archive: { left_out: unknown[] } };
    const expected = [
      {
        file: "index.html",
        reference: "../notes.txt",
        path: "../notes.txt",
        reason: "received",
        levels_up: 1,
      },
      {
        file: "mine.html",
        reference: "../.env",
        path: "../.env",
        reason: "blocklisted",
        levels_up: 1,
      },
      {
        file: "mine.html",
        reference: "../data.json",
        path: "../data.json",
        reason: "file_type",
        levels_up: 1,
      },
    ];
    expect(archive.left_out).toHaveLength(3);
    expect(archive.left_out).toEqual(expect.arrayContaining(expected));
    const events = result.stderr
      .split("\n")
      .filter((line) => line.startsWith('{"event":"left_out"'))
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events).toEqual(
      archive.left_out.map((entry) => ({ event: "left_out", ...(entry as object) })),
    );
    // The person's warning is still printed beside each event.
    expect(result.stderr).toContain("mine.html references ../.env, which is outside the project");
  });
});
