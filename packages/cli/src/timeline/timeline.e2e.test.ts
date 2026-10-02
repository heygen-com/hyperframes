import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isClipVisibleAt } from "@hyperframes/core";
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

  const meeting = (aStart: string, aDuration: string, bStart: string, fps = "") =>
    `<div data-composition-id="main"${fps} data-duration="40"><div id="a" data-hf-id="a" data-start="${aStart}" data-duration="${aDuration}" data-track-index="0"></div><div id="b" data-hf-id="b" data-start="${bStart}" data-duration="2" data-track-index="0"></div></div>`;
  const clip = (html: string, id: string) => {
    const tag = new RegExp(`<div[^>]*\\sid="${id}"[^>]*>`).exec(html)?.[0] ?? "";
    const attr = (name: string) => new RegExp(`${name}="([^"]+)"`).exec(tag)?.[1];
    return { start: attr("data-start"), duration: attr("data-duration") };
  };
  const endOf = (html: string, id: string) =>
    Number(clip(html, id).start) + Number(clip(html, id).duration);
  const visibleAt = (html: string, time: number, ids: string[]) =>
    ids.filter((id) => isClipVisibleAt(time, Number(clip(html, id).start), endOf(html, id), 40));

  const composition = (fps: string, ...clips: [string, string, string][]) =>
    `<div data-composition-id="main"${fps} data-duration="40">${clips
      .map(
        ([id, start, duration]) =>
          `<div id="${id}" data-hf-id="${id}" data-start="${start}" data-duration="${duration}" data-track-index="0"></div>`,
      )
      .join("")}</div>`;

  it.each([
    [
      "move",
      ["#b", "20f"],
      composition(' data-fps="24"', ["a", "0", String(20 / 24 + 5e-7)], ["b", "2", "0.25"]),
    ],
    ["duplicate", ["#c", "--at", "1"], composition("", ["a", "0", "1.0000005"], ["c", "3", "1"])],
  ])("refuses a %s that lands half a microsecond inside another clip", (verb, args, html) => {
    const dir = project();
    try {
      writeFileSync(join(dir, "index.html"), html);
      expect(run(dir, verb, ...args).status).not.toBe(0);
      expect(readFileSync(join(dir, "index.html"), "utf8")).toBe(html);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([
    [
      "a clip wholly before the insertion point",
      ["#x", "--at", "5"],
      composition("", ["x", "0", "1"], ["t", "4.9999995", "0.0000002"]),
      4.9999995,
    ],
    [
      "a clip half a microsecond after it",
      ["#a"],
      composition("", ["a", "0", "1"], ["t", "1.0000005", "1"]),
      1.0000005 + 1,
    ],
  ])("duplicates without snapping %s to the copy", (_, args, html, tStart) => {
    const dir = project();
    try {
      writeFileSync(join(dir, "index.html"), html);
      expect(run(dir, "duplicate", ...args).status).toBe(0);
      expect(Number(clip(readFileSync(join(dir, "index.html"), "utf8"), "t").start)).toBe(tStart);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("trims a clip that only meets the one before it, ending where asked", () => {
    const dir = project();
    try {
      writeFileSync(join(dir, "index.html"), meeting("19.8", "6.4", "26.2"));
      expect(run(dir, "trim", "#b", "--end", "29").status).toBe(0);
      const html = readFileSync(join(dir, "index.html"), "utf8");
      expect(clip(html, "b")).toEqual({ start: "26.2", duration: "2.8000000000000007" });
      expect(endOf(html, "b")).toBe(29);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("trims up to the next clip's start without ending past it, where no duration lands exactly", () => {
    const dir = project();
    try {
      writeFileSync(join(dir, "index.html"), meeting("4.74", "10", "25.74"));
      expect(run(dir, "trim", "#a", "--end", "25.74").status).toBe(0);
      const html = readFileSync(join(dir, "index.html"), "utf8");
      expect(endOf(html, "a")).toBeLessThanOrEqual(25.74);
      expect(visibleAt(html, 25.74, ["a", "b"])).toEqual(["b"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("trims to frame 20 at 30 fps so that frame shows the next clip and not this one", () => {
    const dir = project();
    try {
      writeFileSync(join(dir, "index.html"), meeting("0", "2", "2", ' data-fps="30"'));
      expect(run(dir, "trim", "#a", "--end", "20f").status).toBe(0);
      expect(run(dir, "trim", "#b", "--start", "20f").status).toBe(0);
      const html = readFileSync(join(dir, "index.html"), "utf8");
      expect([clip(html, "a").duration, clip(html, "b").start]).toEqual([
        "0.6666666666666666",
        "0.6666666666666666",
      ]);
      expect(visibleAt(html, 19 / 30, ["a", "b"])).toEqual(["a"]);
      expect(visibleAt(html, 20 / 30, ["a", "b"])).toEqual(["b"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([
    ["19.8", "6.4", "26.2"],
    ["0", "0.6666666666666666", "0.6666666666666666"],
    ["0.1", "1.1", "1.2"],
  ])(
    "duplicates a clip at %s lasting %s up against the clip at %s, each boundary exact",
    (aStart, aDuration, bStart) => {
      const dir = project();
      try {
        writeFileSync(join(dir, "index.html"), meeting(aStart, aDuration, bStart));
        expect(run(dir, "duplicate", "#a").status).toBe(0);
        const html = readFileSync(join(dir, "index.html"), "utf8");
        const ids = ["a", "a-copy", "b"];
        expect(Number(clip(html, "a-copy").start)).toBe(endOf(html, "a"));
        expect(Number(clip(html, "b").start)).toBe(endOf(html, "a-copy"));
        expect(visibleAt(html, endOf(html, "a"), ids)).toEqual(["a-copy"]);
        expect(visibleAt(html, endOf(html, "a-copy"), ids)).toEqual(["b"]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

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
      expect(html.match(/data-hf-id=/g)).toHaveLength(4);
      expect(html).toContain('id="neighbour" data-hf-id="neighbour" data-start="7"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a trim that would leave a clip one float rounding step long", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-timeline-cli-"));
    try {
      const indexPath = join(dir, "index.html");
      writeFileSync(indexPath, meeting("19.8", "6.4", "26.2"));
      const result = run(dir, "trim", "#b", "--end", "26.200000000000003");
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("trim duration must be positive");
      expect(clip(readFileSync(indexPath, "utf8"), "b").duration).toBe("2");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("moves a clip over pending media, whose unknown length counts as zero", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-timeline-cli-"));
    try {
      const indexPath = join(dir, "index.html");
      writeFileSync(
        indexPath,
        `<div data-composition-id="main" data-duration="12"><div id="a" data-hf-id="a" data-start="3" data-duration="1" data-track-index="0"></div><video id="pending" data-hf-id="pending" src="https://example.com/v.mp4" data-start="1" data-track-index="0"></video></div>`,
      );
      const result = run(dir, "move", "#a", "0.5");
      expect(result.status, result.stderr).toBe(0);
      expect(clip(readFileSync(indexPath, "utf8"), "a").start).toBe("0.5");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses duplicate insertion inside a spanning clip", () => {
    const dir = project();
    try {
      const indexPath = join(dir, "index.html");
      writeFileSync(
        indexPath,
        readFileSync(indexPath, "utf8").replace('data-duration="2"', 'data-duration="4"'),
      );
      const result = run(dir, "duplicate", "#clip", "--at", "3");
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("split the spanning clip first");
      expect(readFileSync(indexPath, "utf8")).not.toContain('id="clip-copy"');
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
