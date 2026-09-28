import type * as fs from "node:fs";

export function withFileLock<T>(lockPath: string, fsModule: typeof fs, task: () => T): T;
