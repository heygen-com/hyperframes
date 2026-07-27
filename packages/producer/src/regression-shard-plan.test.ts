// Guards the computed regression shard matrix.
//
// scripts/plan-regression-shards.mjs re-implements fixture discovery in plain
// JS so the GitHub workflow can plan shards without building the TypeScript
// producer package first. That duplication is the risk these tests exist to
// contain: if the planner and the harness ever disagree about what a fixture
// is, CI would schedule shard args the harness does not recognise, or quietly
// stop running fixtures.

import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkDistributedSupport } from "./regression-harness-distributed.js";
import { discoverTestSuites } from "./regression-harness.js";
import {
  discoverFixtures,
  packShards,
  planShards,
  UNKNOWN_FIXTURE_SECONDS,
} from "../scripts/plan-regression-shards.mjs";

const TESTS_DIR = join(import.meta.dir, "..", "tests");

function readSchedule(): {
  timings?: Record<string, number>;
  excluded?: Record<string, string>;
  distributed?: Record<string, string>;
} {
  return JSON.parse(readFileSync(join(TESTS_DIR, "shard-schedule.json"), "utf-8"));
}

describe("shard planner fixture discovery", () => {
  it("sees every fixture the harness can actually run", () => {
    // The planner matches on directory layout only; the harness additionally
    // validates meta.json and drops invalid fixtures with a warning. So the
    // harness set is a subset. It must never contain something the planner
    // missed — that would be a fixture CI silently stops scheduling.
    const harnessIds = discoverTestSuites(TESTS_DIR, []).map((suite) => suite.id);
    const plannerIds = new Set(discoverFixtures(TESTS_DIR));
    const invisibleToPlanner = harnessIds.filter((id) => !plannerIds.has(id));
    expect(invisibleToPlanner).toEqual([]);
  });

  it("schedules exactly the fixtures the harness can run, minus explicit exclusions", () => {
    // Subset alone is not enough. The matrix is built from planner discovery,
    // which only looks at directory layout, while the harness additionally
    // validates meta.json and drops what fails. So a scheduled fixture whose
    // meta.json later goes invalid would keep its slot in a shard, be skipped
    // at run time with a console warning, and leave the shard green — the
    // fixture stops running and nothing goes red. Pinning set equality is what
    // makes that show up as a failing test.
    const excluded = new Set(Object.keys(readSchedule().excluded ?? {}));
    const harnessRunnable = discoverTestSuites(TESTS_DIR, [])
      .map((suite) => suite.id)
      .filter((id) => !excluded.has(id))
      .sort();
    const scheduled = planShards()
      .include.flatMap((row) => row.args.split(" "))
      .sort();
    expect(scheduled).toEqual(harnessRunnable);
  });

  it("rejects a fixture listed in both timings and excluded", () => {
    // `excluded` wins on conflict, so without this the fixture would quietly
    // stop running while every other invariant still passed.
    const schedule = readSchedule();
    const victim = Object.keys(schedule.timings ?? {})[0] as string;
    const tainted = join(mkdtempSync(join(tmpdir(), "hf-shard-schedule-")), "shard-schedule.json");
    writeFileSync(
      tainted,
      JSON.stringify({
        ...schedule,
        excluded: { ...schedule.excluded, [victim]: "duplicate entry that must be rejected" },
      }),
    );
    expect(() => planShards({ scheduleFile: tainted })).toThrow(/both scheduled and excluded/);
  });

  it("never mixes harness modes within a shard", () => {
    // `--mode` is a per-invocation flag, so a shard carrying both kinds would
    // silently run half of them in the wrong mode.
    const { include } = planShards();
    const distributed = new Set(Object.keys(readSchedule().distributed ?? {}));
    for (const row of include) {
      const fixtures = row.args.split(" ");
      const chunked = fixtures.filter((f) => distributed.has(f));
      expect(chunked.length === 0 || chunked.length === fixtures.length).toBe(true);
      expect(row.mode).toBe(chunked.length > 0 ? "distributed-simulated" : "in-process");
    }
  });

  it("gives every shard a mode the harness accepts", () => {
    // Guards against a typo reaching the workflow, where `--mode=<bad>` throws
    // at parse time inside the container after the image has already built.
    for (const row of planShards().include) {
      expect(["in-process", "distributed-simulated", "lambda-local"]).toContain(row.mode);
    }
  });

  it("rejects a distributed fixture that is not scheduled", () => {
    const schedule = readSchedule();
    const tainted = join(mkdtempSync(join(tmpdir(), "hf-shard-schedule-")), "shard-schedule.json");
    writeFileSync(
      tainted,
      JSON.stringify({
        ...schedule,
        distributed: { ...schedule.distributed, "not-a-real-fixture": "typo" },
      }),
    );
    expect(() => planShards({ scheduleFile: tainted })).toThrow(/are not scheduled/);
  });

  it("only assigns distributed mode to fixtures the harness can actually run that way", () => {
    // The blocking gap: `checkDistributedSupport` refuses HDR, non-integer fps,
    // and fps outside {24,30,60}, and the harness records a refusal as
    // `passed: true` with `skipped`. Skipping was safe while in-process also
    // ran the fixture. It is not safe now — these fixtures run in distributed
    // mode and nowhere else, so a later `hdr: true` or fps edit would turn
    // their only coverage into a green no-op with every other planner
    // invariant still passing. Membership and reason-text checks cannot see
    // that; runtime support has to be part of the committed contract.
    const suites = new Map(discoverTestSuites(TESTS_DIR, []).map((s) => [s.id, s]));
    for (const fixture of Object.keys(readSchedule().distributed ?? {})) {
      const suite = suites.get(fixture);
      expect(
        suite,
        `${fixture} is marked distributed but the harness cannot load it`,
      ).toBeDefined();
      const support = checkDistributedSupport(
        (suite as { meta: { renderConfig: Parameters<typeof checkDistributedSupport>[0] } }).meta
          .renderConfig,
      );
      expect(
        support.supported,
        `${fixture} is scheduled distributed-only but distributed mode refuses it: ` +
          `${support.supported ? "" : support.reason}`,
      ).toBe(true);
    }
  });

  it("would reject a distributed fixture the harness refuses to run chunked", () => {
    // Proves the guard above has teeth rather than passing vacuously.
    const hdr = checkDistributedSupport({ fps: { num: 30, den: 1 }, hdr: true });
    expect(hdr.supported).toBe(false);
    const ntsc = checkDistributedSupport({ fps: { num: 30000, den: 1001 } });
    expect(ntsc.supported).toBe(false);
    const odd = checkDistributedSupport({ fps: { num: 25, den: 1 } });
    expect(odd.supported).toBe(false);
  });

  it("gives every distributed fixture a written reason", () => {
    for (const [fixture, reason] of Object.entries(readSchedule().distributed ?? {})) {
      expect(typeof reason, `${fixture} needs a reason`).toBe("string");
      expect((reason as string).length, `${fixture} needs a real reason`).toBeGreaterThan(20);
    }
  });

  it("gives every excluded fixture a written reason", () => {
    // Exclusions are how a fixture legitimately stays out of CI, so the bar
    // is that someone had to type why. This is what stops the excluded list
    // from becoming the silent dumping ground the old YAML matrix was.
    const excluded = readSchedule().excluded ?? {};
    for (const [fixture, reason] of Object.entries(excluded)) {
      expect(typeof reason, `${fixture} needs a reason`).toBe("string");
      expect((reason as string).length, `${fixture} needs a real reason`).toBeGreaterThan(20);
    }
  });

  it("finds fixtures nested under tests/distributed/", () => {
    const discovered = discoverFixtures(TESTS_DIR);
    // These live at tests/distributed/<name>/ rather than tests/<name>/, and
    // an earlier hand-written matrix scheduled them by bare name.
    for (const nested of ["mp4-h264-sdr", "webm-vp9", "png-sequence"]) {
      expect(discovered).toContain(nested);
    }
  });
});

describe("packShards()", () => {
  it("spreads work so the heaviest shard is no worse than longest-item-plus-average", () => {
    const timings = { a: 600, b: 300, c: 300, d: 120, e: 120, f: 60 };
    const shards = packShards(Object.keys(timings), timings, 3);
    const totals = shards.map((shard) =>
      shard.fixtures.reduce((sum, name) => sum + timings[name], 0),
    );
    // LPT's bound: worst bin <= optimal * 4/3. Optimal here is 500s.
    expect(Math.max(...totals)).toBeLessThanOrEqual(Math.ceil(500 * (4 / 3)));
    expect(shards.flatMap((shard) => shard.fixtures).sort()).toEqual(Object.keys(timings).sort());
  });

  it("keeps a single indivisible fixture as the floor", () => {
    // No amount of sharding beats the slowest single fixture. This is the
    // reason shard count alone cannot drive wall-clock below the long pole.
    const timings = { huge: 1500, small: 10 };
    const shards = packShards(Object.keys(timings), timings, 8);
    expect(Math.max(...shards.map((shard) => shard.seconds))).toBe(1500);
  });

  it("assumes untimed fixtures are expensive rather than free", () => {
    const shards = packShards(["known", "brand-new"], { known: 10 }, 2);
    const newShard = shards.find((shard) => shard.fixtures.includes("brand-new"));
    expect(newShard?.seconds).toBe(UNKNOWN_FIXTURE_SECONDS);
  });

  it("emits no empty shards when fixtures are fewer than the shard count", () => {
    const shards = packShards(["only"], { only: 5 }, 8);
    expect(shards).toHaveLength(1);
  });
});

describe("planShards()", () => {
  it("schedules or explicitly excludes every fixture on disk", () => {
    // The real schedule file must stay exhaustive; this is the check that
    // turns "someone added a fixture and forgot the matrix" into a red build.
    expect(() => planShards()).not.toThrow();
  });

  it("produces a matrix the workflow can consume", () => {
    const { include } = planShards();
    expect(include.length).toBeGreaterThan(0);
    for (const row of include) {
      expect(row.shard).toMatch(/^shard-\d+$/);
      expect(row.args.length).toBeGreaterThan(0);
    }
    // Every scheduled fixture appears exactly once across all shards.
    const scheduled = include.flatMap((row) => row.args.split(" "));
    expect(new Set(scheduled).size).toBe(scheduled.length);
  });

  it("runs every fixture that is not explicitly excluded", () => {
    const { include } = planShards();
    const scheduled = new Set(include.flatMap((row) => row.args.split(" ")));
    const excluded = new Set(Object.keys(readSchedule().excluded ?? {}));
    for (const fixture of discoverFixtures(TESTS_DIR)) {
      expect(scheduled.has(fixture) || excluded.has(fixture)).toBe(true);
    }
  });
});
