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

  it("names an id-less hf ref split from its stable id", () => {
    const dir = project();
    try {
      const indexPath = join(dir, "index.html");
      writeFileSync(indexPath, readFileSync(indexPath, "utf8").replace('id="clip"', ""));
      const result = run(dir, "split", "hf:clip", "2");
      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(indexPath, "utf8")).toContain('id="clip-2"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses the next free numeric split suffix on repeat", () => {
    const dir = project();
    try {
      const first = run(dir, "split", "#clip", "1.5");
      expect(first.status, first.stderr).toBe(0);
      const second = run(dir, "split", "#clip-2", "2.5");
      expect(second.status, second.stderr).toBe(0);
      const html = readFileSync(join(dir, "index.html"), "utf8");
      expect(html).toContain('id="clip-2"');
      expect(html).toContain('id="clip-3"');
      expect(html).not.toContain('id="clip-2-2"');
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

  it("refuses a move whose clip would end beyond the composition", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-timeline-move-bound-"));
    try {
      const indexPath = join(dir, "index.html");
      writeFileSync(
        indexPath,
        `<div data-composition-id="main" data-duration="53"><div id="clip" data-start="1" data-duration="10" data-track-index="0"></div></div>`,
      );
      const result = run(dir, "move", "#clip", "50");
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("end at 60");
      expect(result.stderr).toContain("latest valid start 43");
      expect(readFileSync(indexPath, "utf8")).toContain('data-start="1"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("snaps a known project fps to one frame", () => {
    const dir = project();
    try {
      const indexPath = join(dir, "index.html");
      writeFileSync(
        indexPath,
        readFileSync(indexPath, "utf8").replace(
          'data-composition-id="main"',
          'data-composition-id="main" data-fps="10"',
        ),
      );
      const result = run(dir, "move", "#clip", "1.06", "--snap");
      expect(result.status, result.stderr).toBe(0);
      const output = JSON.parse(result.stdout) as {
        after: Array<{ ref: string; start: number }>;
      };
      expect(output.after.find((row) => row.ref === "#clip")).toMatchObject({
        start: 1.1,
      });
      expect(readFileSync(join(dir, "index.html"), "utf8")).toContain('data-start="1.1"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses the nested composition duration for time bounds", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-timeline-nested-"));
    try {
      writeFileSync(
        join(dir, "index.html"),
        `<div data-composition-id="main" data-duration="60"><div id="host" data-composition-src="sub.html" data-start="10" data-duration="3" data-track-index="0"></div></div>`,
      );
      writeFileSync(
        join(dir, "sub.html"),
        `<div data-composition-id="sub" data-duration="3"><div id="inner" data-start="0" data-duration="1" data-track-index="0"></div></div>`,
      );
      const result = run(dir, "move", "#inner", "45");
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("composition duration");
      expect(readFileSync(join(dir, "sub.html"), "utf8")).toContain('data-start="0"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps --plan JSON aligned with applied JSON and does not write", () => {
    const plannedDir = project();
    const appliedDir = project();
    try {
      const before = readFileSync(join(plannedDir, "index.html"), "utf8");
      const planned = run(plannedDir, "move", "#clip", "+1", "--plan");
      expect(planned.status, planned.stderr).toBe(0);
      const planJson = JSON.parse(planned.stdout) as Record<string, unknown>;
      expect(planJson.planned).toBe(true);
      expect(readFileSync(join(plannedDir, "index.html"), "utf8")).toBe(before);

      const applied = run(appliedDir, "move", "#clip", "+1");
      expect(applied.status, applied.stderr).toBe(0);
      const appliedJson = JSON.parse(applied.stdout) as Record<string, unknown>;
      expect(appliedJson.planned).toBe(false);
      expect(Object.keys(planJson).sort()).toEqual(Object.keys(appliedJson).sort());
      expect(appliedJson.receipt).toMatchObject({ file: "index.html", changed: true });
    } finally {
      rmSync(plannedDir, { recursive: true, force: true });
      rmSync(appliedDir, { recursive: true, force: true });
    }
  });

  it("stamps stable ids with ids", () => {
    const dir = project();
    try {
      const indexPath = join(dir, "index.html");
      writeFileSync(indexPath, readFileSync(indexPath, "utf8").replace(/ data-hf-id="[^"]+"/g, ""));
      const result = run(dir, "ids");
      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(indexPath, "utf8")).toMatch(/data-hf-id=/);
      const output = JSON.parse(result.stdout) as { after: Array<{ ref: string }> };
      expect(output.after.some((row) => row.ref === "#clip")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sets clip attributes", () => {
    const dir = project();
    try {
      const result = run(dir, "set", "#clip", "volume=0.4", "rate=1.5", "track=2");
      expect(result.status, result.stderr).toBe(0);
      const html = readFileSync(join(dir, "index.html"), "utf8");
      expect(html).toContain('data-volume="0.4"');
      expect(html).toContain('data-playback-rate="1.5"');
      expect(html).toContain('data-track-index="2"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("duplicates with insert-and-ripple", () => {
    const dir = project();
    try {
      const result = run(dir, "duplicate", "#clip", "--at", "3");
      expect(result.status, result.stderr).toBe(0);
      const html = readFileSync(join(dir, "index.html"), "utf8");
      expect(html).toContain('id="clip-copy"');
      expect(html.match(/data-hf-id=/g)).toHaveLength(3);
      expect(html).toContain('id="neighbour" data-hf-id="neighbour" data-start="7"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("revalidates each apply edit against the previous edit's source", () => {
    const dir = project();
    try {
      const indexPath = join(dir, "index.html");
      writeFileSync(
        indexPath,
        readFileSync(indexPath, "utf8").replace('data-start="5"', 'data-start="7"'),
      );
      const planPath = join(dir, "edits.json");
      writeFileSync(
        planPath,
        JSON.stringify([
          { verb: "move", ref: "#clip", time: "+1" },
          { verb: "move", ref: "#clip", time: "+2" },
        ]),
      );
      const result = run(dir, "apply", planPath);
      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(indexPath, "utf8")).toContain('data-start="4"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("applies a JSON plan atomically and undoes its receipt", () => {
    const dir = project();
    try {
      const planPath = join(dir, "edits.json");
      writeFileSync(planPath, JSON.stringify([{ verb: "set", ref: "#clip", volume: "0.25" }]));
      const before = readFileSync(join(dir, "index.html"), "utf8");
      const planned = run(dir, "apply", planPath, "--plan");
      expect(planned.status, planned.stderr).toBe(0);
      expect(JSON.parse(planned.stdout)).toMatchObject({ ok: true, planned: true });
      expect(readFileSync(join(dir, "index.html"), "utf8")).toBe(before);

      const applied = run(dir, "apply", planPath);
      expect(applied.status, applied.stderr).toBe(0);
      const appliedJson = JSON.parse(applied.stdout) as { receipt: Array<Record<string, unknown>> };
      expect(readFileSync(join(dir, "index.html"), "utf8")).toContain('data-volume="0.25"');
      const undone = run(dir, "undo", JSON.stringify(appliedJson.receipt[0]));
      expect(undone.status, undone.stderr).toBe(0);
      expect(readFileSync(join(dir, "index.html"), "utf8")).toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
