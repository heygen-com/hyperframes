import { existsSync, mkdirSync } from "node:fs";

export function makeOutputFolder(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}
