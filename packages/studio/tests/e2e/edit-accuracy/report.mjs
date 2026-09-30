/** Scoring and the three report files (results.json, table.md, baseline.json) for the edit accuracy bench. */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { percentile } from "./geometry.mjs";

export const LIMIT_PX = 0.5;
// A frame over 1.5 vsyncs is dropped; raw rAF p95 stays reported so a different rule re-scores without a re-run.
const DROPPED_FRAME_MS = 25;
const WORK_MS = 8;
export const METRICS = [
  "tracking",
  "press",
  "drop",
  "reload",
  "render",
  "undo",
  "flash",
  "paint",
  "smooth",
];
// Edit-to-paint: the first frame painted after a committing input already shows the after-state, and that frame
// comes no later than a frame counts as dropped.
const PAINT_FRAMES = 1;
export const paintOk = (frames, ms) =>
  frames != null && frames <= PAINT_FRAMES && ms != null && ms <= DROPPED_FRAME_MS;

/** Worst-first value per metric; undo ranks by box distance, and its byte failures are counted apart. */
const worstValue = {
  tracking: (r) => r.tracking.max,
  press: (r) => r.pressJump ?? 0,
  drop: (r) => r.drop,
  reload: (r) => r.reload,
  render: (r) => r.render ?? 0,
  undo: (r) => Math.max(r.undo.box, r.undo.redoBox ?? 0),
  flash: (r) => r.flash.bad,
  paint: (r) => r.flash.paint?.frames ?? Infinity,
  smooth: (r) => r.smooth.dropped - r.smooth.control.dropped,
};

/** Dropped frames and main-thread ms per frame at p95, from the raw intervals and trace work a case stores. */
const frameBudget = (smooth) => ({
  ...smooth,
  dropped: smooth.intervals.filter((d) => d > DROPPED_FRAME_MS).length,
  workP95: smooth.work && percentile(smooth.work, 95),
});

/** The metrics each snapshot feeds; a snapshot whose preview never held still fails them. */
const FED_BY = {
  pre: ["press", "undo"],
  committed: ["drop", "reload", "undo"],
  undone: ["undo"],
  redone: ["undo"],
  reloaded: ["reload", "render"],
};
const unsettledMetrics = (r) => new Set(r.unsettled.flatMap((k) => FED_BY[k]));

// fallow-ignore-next-line complexity
export function score(spec, r) {
  if (r.error)
    return {
      ...spec,
      ...r,
      pass: false,
      checks: Object.fromEntries(METRICS.map((m) => [m, false])),
    };
  const smooth = { ...frameBudget(r.smooth), control: frameBudget(r.smooth.control) };
  const checks = {
    tracking: r.tracking.max <= LIMIT_PX,
    press: r.pressJump === null || r.pressJump <= LIMIT_PX,
    drop: r.drop <= LIMIT_PX,
    reload: r.reload <= LIMIT_PX,
    render: r.render !== null && r.render <= LIMIT_PX,
    undo: r.undo.bytes && r.undo.redoBytes && Math.max(r.undo.box, r.undo.redoBox) <= LIMIT_PX,
    // A window the screencast covered under 90% is uncovered, never a pass.
    flash: !r.flash.uncovered && r.flash.bad === 0,
    paint: !r.flash.uncovered && paintOk(r.flash.paint?.frames, r.flash.paint?.ms),
    // Only drops beyond the blank page's, driven the same way in the same Chrome, are the edit's.
    smooth:
      smooth.dropped <= smooth.control.dropped &&
      smooth.workP95 !== null &&
      smooth.workP95 <= WORK_MS,
  };
  for (const m of unsettledMetrics(r)) checks[m] = false;
  return { ...spec, ...r, smooth, pass: Object.values(checks).every(Boolean), checks };
}

const round = (v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v);
// Rounded up for baseline.json, so a stored value passes a limit only if the measured one did (to 1e-11).
const roundUp = (v) => (v === null ? null : Math.ceil(v * 100 - 1e-9) / 100);

const medianMax = (values) =>
  values.length ? `${round(percentile(values, 50))}/${round(Math.max(...values))}` : "-";

function smoothSummary(measured) {
  const s = measured.map((r) => r.smooth);
  return {
    unknown: s.filter((x) => x.workP95 === null).length,
    dropped: medianMax(s.map((x) => x.dropped)),
    control: medianMax(s.map((x) => x.control.dropped)),
    p95: medianMax(s.map((x) => x.p95)),
    controlP95: medianMax(s.map((x) => x.control.p95)),
  };
}

function summarize(results, seconds) {
  const passing = results.filter((r) => r.pass).length;
  // Smoothness is still ungated in CI, so the score is also shown without it.
  const accurate = results.filter((r) =>
    METRICS.every((m) => m === "smooth" || r.checks[m]),
  ).length;
  const measured = results.filter((r) => !r.error);
  const perMetric = METRICS.map((m) => {
    const worst = measured.reduce(
      (a, r) => (!a || worstValue[m](r) > worstValue[m](a) ? r : a),
      null,
    );
    return {
      metric: m,
      pass: results.filter((r) => r.checks[m]).length,
      worst: worst && {
        id: worst.id,
        value: round(worstValue[m](worst)),
        unsettled: unsettledMetrics(worst).has(m),
      },
    };
  });
  return {
    passing,
    accurate,
    total: results.length,
    errors: results.length - measured.length,
    bytesDiffer: {
      undo: measured.filter((r) => !r.undo.bytes).length,
      redo: measured.filter((r) => !r.undo.redoBytes).length,
    },
    perMetric,
    unsettled: measured.filter((r) => r.unsettled.length).length,
    undoTimeouts: measured.filter((r) => r.undoTimeout).length,
    renderErrors: measured.filter((r) => r.renderError).length,
    flash: {
      uncovered: measured.filter((r) => r.flash.uncovered).length,
      badCases: measured.filter((r) => r.flash.bad > 0).length,
      longest: Math.max(0, ...measured.map((r) => r.flash.longest)),
      coverage: round(
        percentile(
          measured.map((r) => r.flash.coverage),
          50,
        ),
      ),
      lowest: round(Math.min(...measured.map((r) => r.flash.coverage))),
      control: round(
        percentile(
          measured.map((r) => r.flash.controlCoverage),
          50,
        ),
      ),
    },
    paint: {
      unknown: measured.filter((r) => !r.flash.paint).length,
      frames: medianMax(measured.filter((r) => r.flash.paint).map((r) => r.flash.paint.frames)),
      ms: medianMax(measured.filter((r) => r.flash.paint?.ms != null).map((r) => r.flash.paint.ms)),
    },
    smooth: smoothSummary(measured),
    seconds: Math.round(seconds),
  };
}

// fallow-ignore-next-line complexity
const metricRow = (m, total) =>
  `| ${m.metric} | ${m.pass}/${total} | ${m.worst?.value ?? "-"}${m.worst?.unsettled ? " (unsettled)" : ""} | ${m.worst?.id ?? "-"} |`;

function table(summary, meta, results) {
  const lines = [
    `# Edit accuracy: ${summary.accurate}/${summary.total} cases pass`,
    "",
    `Every metric counts except smoothness, which is reported against the blank-page control: ${summary.perMetric.find((m) => m.metric === "smooth").pass}/${summary.total} pass it, and ${summary.passing}/${summary.total} pass everything including it.`,
    "",
    `Studio ${meta.studio} (build ${meta.build}), bench ${meta.bench}, grid \`${meta.grid}\`, ${meta.date}, ${summary.seconds}s with ${meta.jobs} jobs, ${summary.errors} harness errors, load ${meta.load}.`,
    `Pass: tracking, press jump, drop, reload and render ≤ ${LIMIT_PX} px; undo and redo byte-identical with the box ≤ ${LIMIT_PX} px; no flash frame and the after-state in the next frame; no more frames over ${DROPPED_FRAME_MS} ms than the blank-page control, and main-thread work ≤ ${WORK_MS} ms per frame at p95.`,
    "",
    `Undo or redo left different bytes in ${summary.bytesDiffer.undo} undo and ${summary.bytesDiffer.redo} redo cases.`,
    `The preview never held still for 1 s within 15 s in ${summary.unsettled} cases; the metrics that snapshot feeds fail.`,
    `An undo or redo write never landed within 15 s in ${summary.undoTimeouts} cases; undo fails there.`,
    `The producer failed to render ${summary.renderErrors} cases; render fails there.`,
    `Flash: ${summary.flash.badCases} cases painted a frame matching neither the state before nor after (longest run ${summary.flash.longest} frames); ${summary.flash.uncovered} cases uncovered; screencast coverage median ${summary.flash.coverage}, lowest ${summary.flash.lowest}, blank control median ${summary.flash.control}.`,
    `Edit-to-paint (pointer-up, key, undo, redo; pass at ${PAINT_FRAMES} frame within ${DROPPED_FRAME_MS} ms): frames to the after-state (median/max) ${summary.paint.frames}, ms ${summary.paint.ms}; ${summary.paint.unknown} cases logged no input.`,
    `Smoothness: ${summary.smooth.unknown} cases with unknown work; dropped frames per case (median/max) ${summary.smooth.dropped}, blank-page control ${summary.smooth.control}; raw rAF p95 (median/max) ${summary.smooth.p95} ms, control ${summary.smooth.controlP95} ms.`,
    "",
    "| Metric | Pass | Worst | Worst case |",
    "|---|---|---|---|",
    ...summary.perMetric.map((m) => metricRow(m, summary.total)),
    "",
    "| Gesture | Cases | Pass | " + METRICS.join(" | ") + " |",
    "|---|---|---|" + METRICS.map(() => "---").join("|") + "|",
  ];
  for (const g of [...new Set(results.map((r) => r.gesture))]) {
    const rs = results.filter((r) => r.gesture === g);
    lines.push(
      `| ${g} | ${rs.length} | ${rs.filter((r) => r.pass).length} | ${METRICS.map((m) => rs.filter((r) => r.checks[m]).length).join(" | ")} |`,
    );
  }
  lines.push(
    "",
    "| Case | Flash frames | Paint frames | 1-frame flash miss chance | Blank control coverage |",
    "|---|---|---|---|---|",
    ...results
      .filter((r) => !r.error)
      .map(
        (r) =>
          `| ${r.id} | ${r.flash.bad} | ${r.flash.paint ? `${r.flash.paint.frames} (${round(r.flash.paint.ms)} ms)` : "-"} | ${round(r.flash.missChance)} | ${round(r.flash.controlCoverage)} |`,
      ),
  );
  return lines.join("\n") + "\n";
}

/** One case as baseline.json holds it; the gate reads the same projection. */
// fallow-ignore-next-line complexity
export function entry(r) {
  if (r.error) return { pass: false, error: true };
  return {
    pass: r.pass,
    tracking: roundUp(r.tracking.max),
    pressJump: roundUp(r.pressJump),
    drop: roundUp(r.drop),
    reload: roundUp(r.reload),
    render: roundUp(r.render),
    undo: r.checks.undo,
    dropped: r.smooth.dropped,
    controlDropped: r.smooth.control.dropped,
    work: roundUp(r.smooth.workP95),
    frameP95: roundUp(r.smooth.p95),
    ...(r.unsettled.length && { unsettled: r.unsettled }),
    ...(r.undoTimeout && { undoTimeout: r.undoTimeout }),
    ...(r.renderError && { renderError: true }),
    flash: r.flash.bad,
    ...(r.flash.uncovered && { flashUncovered: true }),
    paint: r.flash.paint?.frames ?? null,
    paintMs: roundUp(r.flash.paint?.ms ?? null),
  };
}

/** One line per case, so a baseline diff reads case by case. */
function baseline(meta, results) {
  const entries = [...results]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((r) => `    ${JSON.stringify(r.id)}: ${JSON.stringify(entry(r))}`);
  return `{\n  "studio": ${JSON.stringify(meta.studio)},\n  "build": ${JSON.stringify(meta.build)},\n  "bench": ${JSON.stringify(meta.bench)},\n  "grid": ${JSON.stringify(meta.grid)},\n  "cases": {\n${entries.join(",\n")}\n  }\n}\n`;
}

/** Writes results.json, table.md and baseline.json into `out`; returns the table. */
export function writeReport(out, meta, results, seconds) {
  const summary = summarize(results, seconds);
  writeFileSync(
    join(out, "results.json"),
    JSON.stringify({ meta, summary, cases: results }, null, 1),
  );
  writeFileSync(join(out, "table.md"), table(summary, meta, results));
  writeFileSync(join(out, "baseline.json"), baseline(meta, results));
  return table(summary, meta, results);
}
