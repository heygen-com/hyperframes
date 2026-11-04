import { mkdirSync, statSync } from "node:fs";

const isFolder = (dir: string) => statSync(dir, { throwIfNoEntry: false })?.isDirectory() === true;

export function makeOutputFolder(dir: string): void {
  if (!isFolder(dir)) mkdirSync(dir, { recursive: true });
}
