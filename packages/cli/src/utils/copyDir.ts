import { copyFileSync, mkdirSync, readdirSync, readlinkSync, symlinkSync } from "node:fs";
import { join } from "node:path";

/** `src`'s files copied into `dest`, merging with what is there. Not fs.cpSync: on Windows, Node kills the process
 * (0xC0000409) when `dest` is a folder that already exists directly under a drive root, as `init D:\name` makes it. */
export function copyDirSync(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(from, to);
    else if (entry.isSymbolicLink()) symlinkSync(readlinkSync(from), to);
    else copyFileSync(from, to);
  }
}
