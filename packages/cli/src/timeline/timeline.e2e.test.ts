import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cliEntry = resolve(fileURLToPath(import.meta.url), "..", "..", "cli.ts");

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-timeline-cli-"));
  writeFileSync(
    join(dir, "index.html"),
    `<div data-composition-id="main" data-duration="12"><div id="clip" data-hf-id="clip" data-start="1" data-duration="2" data-track-index="0"></div><div id="neighbour" data-hf-id="neighbour" data-start="5" data-duration="2" data-track-index="0"></div></div>`,
  );
  return dir;
}

function run(dir: string, ...args: string[]) {
  return spawnSync(
    "bun",
    ["run", cliEntry, "timeline", args[0]!, "--dir", dir, "--json", ...args.slice(1)],
    {
      cwd: dir,
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env, HYPERFRAMES_SKIP_UPDATE_CHECK: "1" },
    },
  );
}

describe("timeline edit command", () => {
  it.each([
    ["move", ["#clip", "+1"], 'data-start="2"'],
    ["trim", ["#clip", "--duration", "1"], 'data-duration="1"'],
    ["split", ["#clip", "2"], 'id="clip-2"'],
    ["delete", ["#clip"], 'id="clip"'],
  ])("executes %s against a temp project", (verb, args, marker) => {
    const dir = project();
    try {
      const result = run(dir, verb, ...args);
      expect(result.status, result.stderr).toBe(0);
      const output = JSON.parse(result.stdout) as {
        before: Array<{ ref: string }>;
        after: Array<{ ref: string; start: number; duration: number }>;
      };
      expect(output).toMatchObject({
        ok: true,
        receipt: expect.any(Object),
      });
      expect(output.before.some((row) => row.ref === "#clip")).toBe(true);
      const clipAfter = output.after.find((row) => row.ref === "#clip");
      if (verb === "move") expect(clipAfter).toMatchObject({ start: 2 });
      if (verb === "trim") expect(clipAfter).toMatchObject({ duration: 1 });
      if (verb === "split") expect(output.after).toHaveLength(3);
      if (verb === "delete") expect(clipAfter).toBeUndefined();
      const html = readFileSync(join(dir, "index.html"), "utf8");
      if (verb === "delete") expect(html).not.toContain('id="clip"');
      else expect(html).toContain(marker);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses overlap", () => {
    const dir = project();
    try {
      const result = run(dir, "move", "#clip", "4");
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("--overwrite");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses an ambiguous reference", () => {
    const dir = project();
    try {
      writeFileSync(
        join(dir, "index.html"),
        `<div data-composition-id="main"><div id="dup" data-start="1" data-duration="2" data-track-index="0"></div><div id="dup" data-start="5" data-duration="2" data-track-index="0"></div></div>`,
      );
      const result = run(dir, "delete", "#dup");
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("matches 2 rows");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses snap when the project fps is unknown", () => {
    const dir = project();
    try {
      const result = run(dir, "move", "#clip", "1.03", "--snap");
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("set data-fps");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
