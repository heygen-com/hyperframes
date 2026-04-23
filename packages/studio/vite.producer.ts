import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export function resolveProducerDistEntry(studioDir: string): string {
  return resolve(studioDir, "../producer/dist/index.js");
}

export function resolveWorkspaceRoot(studioDir: string): string {
  return resolve(studioDir, "../..");
}

export function ensureProducerDist(opts: {
  studioDir: string;
  existsSyncImpl?: (path: string) => boolean;
  execFileSyncImpl?: typeof execFileSync;
  env?: NodeJS.ProcessEnv;
}): { built: boolean; producerDistEntry: string } {
  const producerDistEntry = resolveProducerDistEntry(opts.studioDir);
  const exists = opts.existsSyncImpl ?? existsSync;
  if (exists(producerDistEntry)) {
    return { built: false, producerDistEntry };
  }

  const exec = opts.execFileSyncImpl ?? execFileSync;
  exec("bun", ["run", "--filter", "@hyperframes/producer", "build"], {
    cwd: resolveWorkspaceRoot(opts.studioDir),
    stdio: "pipe",
    env: opts.env,
  });

  return { built: true, producerDistEntry };
}

export function createRetryingModuleLoader<T>(load: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | null = null;

  return async () => {
    if (!promise) {
      promise = load().catch((error) => {
        promise = null;
        throw error;
      });
    }
    return promise;
  };
}
