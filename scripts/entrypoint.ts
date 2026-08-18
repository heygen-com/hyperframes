/**
 * Run a script's `main()` only when it is the process entrypoint.
 *
 * The catalog generators import helpers from each other, so an unguarded
 * top-level `main()` would run a whole build the moment the other script
 * imported it. Each had grown its own copy of the same guard.
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Was this module the file node was asked to run, rather than an import? */
export function isEntrypoint(moduleUrl: string): boolean {
  const invoked = process.argv[1];
  return invoked !== undefined && resolve(invoked) === fileURLToPath(moduleUrl);
}

/** Run `main()` when this module is the entrypoint, exiting non-zero if it throws. */
export function runAsCommand(moduleUrl: string, main: () => Promise<void>): void {
  if (!isEntrypoint(moduleUrl)) return;
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
