import { c } from "./colors.js";

const { stdout } = process;

let lastPrintedThreshold = -1;

export function renderProgress(percent: number, stage: string, row?: number): void {
  // Non-TTY: write clean lines at 10% intervals, skip bar computation entirely
  if (!stdout.isTTY) {
    const rounded = Math.round(percent);
    if ((rounded % 10 === 0 || rounded === 100) && rounded !== lastPrintedThreshold) {
      lastPrintedThreshold = rounded;
      stdout.write(`  ${rounded}%  ${stage}\n`);
    }
    return;
  }

  const width = 25;
  const filled = Math.floor(percent / (100 / width));
  const empty = width - filled;
  const bar = c.progress("\u2588".repeat(filled)) + c.dim("\u2591".repeat(empty));

  const line = `  ${bar}  ${c.bold(String(Math.round(percent)) + "%")}  ${c.dim(stage)}`;

  if (row !== undefined) {
    stdout.write(`\x1b[${row};1H\x1b[2K${line}`);
  } else {
    stdout.write(`\r\x1b[2K${line}`);
  }
}
