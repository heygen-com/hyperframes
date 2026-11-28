import { statSync, type Stats } from "node:fs";
import { terminalLines } from "@hyperframes/core";
import { requestCliExit } from "./commandResult.js";
import { recordFailure } from "./jsonError.js";

export interface RenderJsonSuccess {
  ok: true;
  outputPath: string;
  durationMs?: number;
  renderTimeMs: number;
  bytes?: number;
}

export interface RenderJsonCancelled {
  ok: false;
  error: {
    code: "cancelled";
    signal: RenderCancelSignal;
    message: string;
  };
}

type FileInfo = Pick<Stats, "isFile" | "size">;

const RENDER_CANCEL_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
type RenderCancelSignal = (typeof RENDER_CANCEL_SIGNALS)[number];

function cancelSignalFromReason(reason: string): RenderCancelSignal | undefined {
  return RENDER_CANCEL_SIGNALS.find(
    (signal) => reason === `render_cancelled_by_${signal.toLowerCase()}`,
  );
}

/** The one success object a `--json` render prints: the path as written plus the stats it has. */
export function renderSuccessBody(
  outputPath: string,
  result: { durationMs?: number; renderTimeMs: number },
  fileInfo: (path: string) => FileInfo = statSync,
): RenderJsonSuccess {
  let bytes: number | undefined;
  try {
    const info = fileInfo(outputPath);
    if (info.isFile()) bytes = info.size;
  } catch {
    // A missing output is the render's failure to report; the success line simply omits its size.
  }
  return {
    ok: true,
    outputPath,
    ...(result.durationMs === undefined ? {} : { durationMs: result.durationMs }),
    renderTimeMs: result.renderTimeMs,
    ...(bytes === undefined ? {} : { bytes }),
  };
}

/** The cancel object for a render stopped by a signal, from the cancellation scope's reason. */
export function renderCancelBody(reason: string): RenderJsonCancelled | undefined {
  const signal = cancelSignalFromReason(reason);
  if (signal === undefined) return undefined;
  return {
    ok: false,
    error: {
      code: "cancelled",
      signal,
      message: `Render cancelled: ${reason}`,
    },
  };
}

export function writeRenderJson(body: RenderJsonSuccess | RenderJsonCancelled): void {
  process.stdout.write(`${JSON.stringify(body)}\n`);
}

/** Keep the human cancel line as it is, add the `--json` object, then exit 1. */
export function reportRenderCancellation(reason: unknown, json: boolean): void {
  const message = reason instanceof Error ? reason.message : String(reason);
  process.stderr.write(`Render cancelled: ${terminalLines(message)}\n`);
  recordFailure(`Render cancelled: ${message}`);
  if (json) {
    const body = renderCancelBody(message);
    if (body) writeRenderJson(body);
  }
  requestCliExit(1);
}
