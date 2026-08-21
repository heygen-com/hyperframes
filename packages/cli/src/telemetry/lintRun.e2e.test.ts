// End-to-end: a real project on disk -> lintProject -> the exact PostHog
// payloads. Unit tests cover the streak arithmetic; this proves the wiring
// and pins the event shape a dashboard will be built against.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOME = mkdtempSync(join(tmpdir(), "hf-lintrun-"));
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => HOME };
});

// Capture at the transport boundary so everything client.ts adds
// (cli_version, invocation_id, ...) is visible in the assertions.
const enqueued: Array<{ event: string; properties: Record<string, unknown> }> = [];
vi.mock("./transport.js", () => ({
  enqueue: (event: string, properties: Record<string, unknown>) =>
    enqueued.push({ event, properties }),
  flush: () => Promise.resolve(),
}));
// shouldTrack() consults these two. A dev build disables telemetry by default,
// which would make this test assert on an empty queue and pass for the wrong
// reason.
vi.mock("./policy.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./policy.js")>();
  return { ...actual, telemetryRuntimeOverride: () => null };
});
vi.mock("./config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config.js")>();
  return { ...actual, readConfig: () => ({ ...actual.readConfig(), telemetryEnabled: true }) };
});

const { trackLintRun } = await import("./lintRun.js");
const { lintProject } = await import("@hyperframes/lint");

const COMPOSITION = `<html><body>
  <div id="scene" data-composition-id="main" data-width="1920" data-height="1080"
       data-start="0" data-duration="4">
    <video id="clip" src="clip.mp4"></video>
  </div>
  <script src="gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    window.__timelines["main"] = gsap.timeline({ paused: true });
  </script>
</body></html>`;

function makeProject(html: string): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-proj-"));
  mkdirSync(join(dir, "compositions"), { recursive: true });
  writeFileSync(join(dir, "index.html"), html, "utf-8");
  return dir;
}

beforeEach(() => {
  enqueued.length = 0;
  rmSync(join(HOME, ".hyperframes"), { recursive: true, force: true });
});

describe("trackLintRun end to end", () => {
  it("emits one lint_report carrying codes, timings, and the ruleset fingerprint", async () => {
    const dir = makeProject(COMPOSITION);
    const result = await lintProject(dir);
    trackLintRun(dir, result, { command: "lint", durationMs: 12 });

    const reports = enqueued.filter((e) => e.event === "lint_report");
    expect(reports).toHaveLength(1);
    const props = reports[0]!.properties;

    expect(props["command"]).toBe("lint");
    expect(props["files_scanned"]).toBe(1);
    expect(props["duration_ms"]).toBe(12);
    // The real linter found real problems in this composition.
    expect((props["codes"] as string[]).length).toBeGreaterThan(0);
    expect(props["error_count"]).toBeGreaterThan(0);
    // Timings are attributed per rule group and a slowest rule is identified.
    expect(Object.keys(props["rule_group_ms"] as object)).toContain("gsap");
    expect(props["slowest_rule"]).toMatch(/^[a-z]+#\d+$/);
    // Version and ruleset fingerprint ride along.
    expect(props["cli_version"]).toBeTruthy();
    expect(props["rule_count"]).toBeGreaterThan(0);
    // Per-group sizes make the positional `slowest_rule` index comparable
    // across builds: a group that changed size renumbered its rules.
    const groupCounts = props["rule_group_counts"] as Record<string, number>;
    expect(groupCounts["gsap"]).toBeGreaterThan(0);
    expect(Object.values(groupCounts).reduce((a, b) => a + b, 0)).toBe(props["rule_count"]);
    // code_counts sums to the number of findings.
    const counts = Object.values(props["code_counts"] as Record<string, number>);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(
      result.results.flatMap((r) => r.result.findings).length,
    );

    rmSync(dir, { recursive: true, force: true });
  });

  it("emits lint_rule_streak with cleared:true once an edit removes the finding", async () => {
    const dir = makeProject(COMPOSITION);

    const first = await lintProject(dir);
    trackLintRun(dir, first, { command: "lint", durationMs: 1 });
    const codes = first.results[0]!.result.findings.map((f) => f.code);
    expect(codes).toContain("media_missing_data_start");

    // Fix exactly that finding and re-lint.
    writeFileSync(
      join(dir, "index.html"),
      COMPOSITION.replace('<video id="clip"', '<video id="clip" data-start="0" data-duration="4"'),
      "utf-8",
    );
    enqueued.length = 0;
    const second = await lintProject(dir);
    trackLintRun(dir, second, { command: "lint", durationMs: 1 });

    const streaks = enqueued.filter((e) => e.event === "lint_rule_streak");
    const cleared = streaks.find((e) => e.properties["code"] === "media_missing_data_start");
    expect(cleared?.properties).toMatchObject({
      code: "media_missing_data_start",
      cleared: true,
      edits: 1,
      command: "lint",
    });

    rmSync(dir, { recursive: true, force: true });
  });

  it("never throws when the lint result is malformed", () => {
    expect(() =>
      trackLintRun("/nope", { results: [] } as never, { command: "lint", durationMs: 0 }),
    ).not.toThrow();
  });
});
