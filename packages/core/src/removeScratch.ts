import { AsyncLocalStorage } from "node:async_hooks";
import { rmSync } from "node:fs";

const collecting = new AsyncLocalStorage<string[]>();

/** Removes a scratch folder or file the mix is already done with. A refusal (Windows temp folders that deny
 * delete) leaves it for the render's own cleanup and never fails the audio it served. */
export function removeScratch(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    collecting.getStore()?.push(path);
  }
}

/** Runs `run`; whatever removeScratch left behind inside it (this run's only) goes to `report` once it ends. */
export async function collectScratchLeftovers<T>(
  run: () => Promise<T>,
  report: (left: string[]) => void,
): Promise<T> {
  const left: string[] = [];
  try {
    return await collecting.run(left, run);
  } finally {
    report(left);
  }
}
