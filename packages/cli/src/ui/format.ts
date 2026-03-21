import { c } from "./colors.js";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds - minutes * 60;
  return `${minutes}m ${remaining.toFixed(1)}s`;
}

export function label(name: string, value: string): string {
  const pad = 14 - name.length;
  return `   ${c.dim(name)}${" ".repeat(Math.max(1, pad))}${c.bold(value)}`;
}

export function errorBox(title: string, hint?: string, suggestion?: string): void {
  console.error(`\n${c.error("\u2717")}  ${c.bold(title)}`);
  if (hint) console.error(`\n   ${c.dim(hint)}`);
  if (suggestion) console.error(`   ${c.accent(suggestion)}`);
  console.error();
}
