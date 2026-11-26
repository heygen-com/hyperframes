/** The part of the film a render asks for, in film seconds; the output starts at 0. No end: to the film's end. */
export interface RenderRange {
  startSeconds: number;
  endSeconds?: number;
}

type Parsed = { ok: true; range?: RenderRange } | { ok: false; error: string };

const isSeconds = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

export function parseRenderRange(body: { start?: unknown; end?: unknown }): Parsed {
  if (body.start === undefined && body.end === undefined) return { ok: true };
  if (body.start !== undefined && !isSeconds(body.start)) {
    return { ok: false, error: "start must be a number of seconds, 0 or more" };
  }
  if (body.end !== undefined && !isSeconds(body.end)) {
    return { ok: false, error: "end must be a number of seconds, 0 or more" };
  }
  const startSeconds = body.start ?? 0;
  if (body.end !== undefined && body.end <= startSeconds) {
    return { ok: false, error: "end must be after start" };
  }
  return {
    ok: true,
    range: { startSeconds, ...(body.end === undefined ? {} : { endSeconds: body.end }) },
  };
}
