#!/usr/bin/env node
// Edit accuracy gate against the base branch's baseline.json; smoothness is reported, never gated.
// `flipped <base> <results>` lists cases to re-run twice; `gate <base> <head> <out> <results...>` judges 2 of 3.
// A case whose runs disagree is listed as unstable.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LIMIT_PX, entry, writeReport } from "./report.mjs";

const GATED_PX = ["tracking", "pressJump", "drop", "reload", "render", "renderKey"];
const LISTED = 30;

/** Passes every gated metric; an unsettled preview fails the metrics it fed, all of them gated. */
// fallow-ignore-next-line complexity
export const accurate = (e) =>
  Boolean(e) &&
  !e.error &&
  !e.unsettled &&
  !e.renderError &&
  e.undo === true &&
  // A pass/fail value, so an unmeasured drag fails; base entries from before the metric hold none.
  e.teleport !== false &&
  // A text case's edit opened, and its word saved and shown (and a word selected, for select).
  e.text !== false &&
  // Keyframed cases: other keyframes unchanged, no stray CSS, and a measured second render.
  e.keys !== false &&
  e.css !== false &&
  e.renderKey !== null &&
  GATED_PX.every((m) => !(e[m] > LIMIT_PX));

/** Cases whose verdict here differs from the base branch, either way: each is re-run twice before the gate. */
export const flipped = (base, results) =>
  results.filter((r) => accurate(base.cases[r.id]) !== accurate(entry(r))).map((r) => r.id);

const summary = (e) =>
  e.error
    ? "error"
    : `${GATED_PX.map((m) => `${m} ${e[m] ?? "-"}`).join(", ")}, undo ${e.undo}, teleport ${e.teleport ?? "-"}`;

/** The gate's verdict on one case's runs: it passes when fewer than half fail. */
const passes = (entries) => entries.filter((e) => !accurate(e)).length * 2 < entries.length;
/** Reported, never gated: most runs had no extra dropped frame and no frame over the work budget. */
const mostlySmooth = (entries) => entries.filter((e) => e.smooth).length * 2 > entries.length;

/** One run per case that agrees with the gate's verdict, so a banked baseline.json matches the gate. */
export function bankable(runs) {
  const byId = Map.groupBy(runs, (r) => r.id);
  return [...byId.values()].map((rs) => {
    const verdict = passes(rs.map(entry));
    return rs.find((r) => accurate(entry(r)) === verdict);
  });
}

/**
 * Cases a real Studio race flips run to run, with the PR fixing it: measured and listed every run, never gated.
 * The fixing PR deletes its own ids here and re-banks them in the same PR.
 */
export const QUARANTINED = {
  // A redo or undo write waits behind preview videos holding all of Chrome's connections to the host.
  "seqnudge-none-pct-r0-nested-z100": "#4889",
};

/** Every run of every case: each shard's run plus the re-runs of the cases it flipped. */
// fallow-ignore-next-line complexity
export function gate(base, head, runs, quarantine = QUARANTINED) {
  const seen = new Map();
  for (const r of runs) seen.set(r.id, [...(seen.get(r.id) ?? []), entry(r)]);
  const all = [...seen].map(([id, entries]) => {
    return {
      id,
      entries,
      passed: passes(entries),
      basePassed: accurate(base.cases[id]),
    };
  });
  const cases = all.filter((c) => !Object.hasOwn(quarantine, c.id));
  const passing = cases.filter((c) => c.passed);
  const result = {
    quarantined: Object.entries(quarantine).map(([id, fixer]) => {
      const c = all.find((x) => x.id === id);
      return { id, fixer, passed: c?.passed ?? null, runs: c?.entries.map(accurate) ?? [] };
    }),
    basePassing: Object.entries(base.cases).filter(
      ([id, e]) => !Object.hasOwn(quarantine, id) && accurate(e),
    ).length,
    headPassing: passing.length,
    headSmooth: passing.filter((c) => mostlySmooth(c.entries)).length,
    regressed: cases.filter((c) => c.basePassed && !c.passed).map((c) => c.id),
    unstable: cases
      .filter((c) => new Set(c.entries.map(accurate)).size > 1)
      .map((c) => ({ id: c.id, runs: c.entries.map(summary) })),
    newlyPassing: passing.filter((c) => !c.basePassed).map((c) => c.id),
    unbanked: passing.filter((c) => !accurate(head.cases[c.id])).map((c) => c.id),
    overclaimed: cases.filter((c) => !c.passed && accurate(head.cases[c.id])).map((c) => c.id),
    missing: Object.keys(base.cases).filter((id) => !seen.has(id)),
  };
  const reasons = [
    result.regressed.length &&
      `${result.regressed.length} case(s) that pass on the base branch fail here`,
    result.headPassing < result.basePassing &&
      `the passing count fell from ${result.basePassing} to ${result.headPassing}`,
    result.unbanked.length &&
      `${result.unbanked.length} newly passing case(s) are not banked in baseline.json`,
    result.overclaimed.length &&
      `baseline.json marks ${result.overclaimed.length} failing case(s) as passing`,
  ].filter(Boolean);
  return { ...result, ok: reasons.length === 0, reasons };
}

const list = (title, ids) =>
  ids.length
    ? [
        `**${title}** (${ids.length})`,
        ...ids.slice(0, LISTED).map((id) => `- ${id}`),
        ids.length > LISTED ? `- ...` : "",
        "",
      ]
    : [];

export function comment(g) {
  return [
    "<!-- edit-accuracy -->",
    `### Edit accuracy: accurate ${g.headPassing} (base branch ${g.basePassing}), smooth ${g.headSmooth} of those`,
    "",
    g.ok ? "The gate passes." : `The gate fails: ${g.reasons.join("; ")}.`,
    "Smoothness is reported in the artifact, not gated. A case fails only if it fails 2 of 3 runs.",
    "",
    ...list("Regressed", g.regressed),
    ...list("Newly passing", g.newlyPassing),
    ...list("Not banked (commit the artifact's baseline.json)", g.unbanked),
    ...list("Marked passing in baseline.json but failing", g.overclaimed),
    ...list("In the base grid but not run", g.missing),
    `**Quarantined, measured but not gated** (${g.quarantined.length})`,
    ...g.quarantined.map(
      (q) =>
        `- ${q.id} (fixed by ${q.fixer}): ${q.runs.map((ok) => (ok ? "pass" : "fail")).join(" / ") || "not run"}${q.passed === null ? "" : q.passed ? ", passes" : ", fails"}`,
    ),
    "",
    ...(g.unstable.length
      ? [
          `**Unstable** (${g.unstable.length})`,
          ...g.unstable.slice(0, LISTED).map((u) => `- ${u.id}: ${u.runs.join(" / ")}`),
          "",
        ]
      : []),
  ].join("\n");
}

// Strict: CI writes {"cases":{}} for a missing base, so a file that does not parse is broken, not empty.
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

// fallow-ignore-next-line complexity
function main([command, basePath, ...rest]) {
  const base = readJson(basePath);
  if (command === "flipped") {
    for (const id of flipped(base, readJson(rest[0]).cases)) console.log(id);
    return 0;
  }
  const [headPath, out, ...resultPaths] = rest;
  const runs = resultPaths.map((p) => readJson(p));
  if (!runs.length) throw new Error("no results.json from any shard");
  const g = gate(
    base,
    readJson(headPath),
    runs.flatMap((r) => r.cases),
  );
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "comment.md"), comment(g));
  writeFileSync(join(out, "gate.json"), JSON.stringify(g, null, 1));
  // A baseline.json to commit when cases newly pass.
  writeReport(
    out,
    { ...runs[0].meta, grid: "full (CI)" },
    bankable(runs.flatMap((r) => r.cases)),
    0,
  );
  console.log(comment(g));
  return g.ok ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  process.exitCode = main(process.argv.slice(2));
