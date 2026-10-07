import { c } from "./colors.js";
import type { RenderJob } from "@hyperframes/producer";

const { stdout } = process;

export function renderProgress(percent: number, stage: string, row?: number): void {
  const width = 25;
  const filled = Math.floor(percent / (100 / width));
  const empty = width - filled;
  const bar = c.progress("\u2588".repeat(filled)) + c.dim("\u2591".repeat(empty));

  const line = `  ${bar}  ${c.bold(String(Math.round(percent)) + "%")}  ${c.dim(stage)}`;

  if (row !== undefined && stdout.isTTY) {
    stdout.write(`\x1b[${row};1H\x1b[2K${line}`);
  } else if (!stdout.isTTY) {
    stdout.write(`${line}\n`);
  } else {
    stdout.write(`\r\x1b[2K${line}`);
  }
}

export function renderMachineProgress(percent: number, stage: RenderJob["stageProgress"]): void {
  if (stdout.isTTY || process.env.HYPERFRAMES_STDOUT_IS_TTY === "1" || !stage) return;
  stdout.write(`@hf-progress ${JSON.stringify({ ...stage, pct: Math.round(percent) })}\n`);
}
