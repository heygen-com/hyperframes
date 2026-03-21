import { c } from "./colors.js";

const { stdout } = process;

export function renderProgress(percent: number, stage: string, row?: number): void {
  const width = 25;
  const filled = Math.floor(percent / (100 / width));
  const empty = width - filled;
  const bar =
    c.progress("\u2588".repeat(filled)) +
    c.dim("\u2591".repeat(empty));

  const line = `  ${bar}  ${c.bold(String(Math.round(percent)) + "%")}  ${c.dim(stage)}`;

  if (row !== undefined && stdout.isTTY) {
    stdout.write(`\x1b[${row};1H\x1b[2K${line}`);
  } else {
    stdout.write(`\r\x1b[2K${line}`);
  }
}
