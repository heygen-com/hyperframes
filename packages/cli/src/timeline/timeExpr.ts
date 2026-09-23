import type { TimelineRow } from "./describeProject.js";

export interface TimeExpressionContext {
  row: TimelineRow;
  duration: number;
  fps: number;
  resolveAnchor: (ref: string) => TimelineRow | undefined;
}

export type TimeExpression = { ok: true; seconds: number } | { ok: false; reason: string };

export function parseTimeExpression(
  expression: string,
  context: TimeExpressionContext,
): TimeExpression {
  const raw = expression.trim();
  if (raw === "end") return { ok: true, seconds: context.duration };
  const frames = /^(-?\d+(?:\.\d+)?)f$/.exec(raw);
  if (frames) return { ok: true, seconds: Number(frames[1]) / context.fps };
  const absolute = /^\d+(?:\.\d+)?$/.test(raw);
  const relative = /^[+-]\d+(?:\.\d+)?$/.test(raw);
  if (absolute) return { ok: true, seconds: Number(raw) };
  if (relative) return { ok: true, seconds: context.row.start + Number(raw) };
  const anchor = /^(after|before|start-of|end-of):(.+)$/.exec(raw);
  if (!anchor) return { ok: false, reason: `invalid time expression: ${expression}` };
  const row = context.resolveAnchor(anchor[2]!);
  if (!row) return { ok: false, reason: `anchor ref not found: ${anchor[2]}` };
  switch (anchor[1]) {
    case "after":
    case "end-of":
      return { ok: true, seconds: row.end };
    case "before":
    case "start-of":
      return { ok: true, seconds: row.start };
  }
  return { ok: false, reason: `invalid time anchor: ${anchor[1]}` };
}
