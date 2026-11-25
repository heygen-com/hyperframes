import {
  CacheFolderNotPrivate,
  ensurePrivateCacheDir,
  hyperframesCacheDir,
} from "@hyperframes/core/cache-dir";
import module from "node:module";

type EnableCompileCache = (dir: string) => unknown;

/** Node's compile cache, only in HyperFrames' private cache folder (never the shared temp folder), else off. */
export function enablePrivateCompileCache(
  enable: EnableCompileCache | undefined = module.enableCompileCache,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (!enable || env["NODE_COMPILE_CACHE"] || env["NODE_DISABLE_COMPILE_CACHE"]) return undefined;
  let dir: string;
  try {
    dir = ensurePrivateCacheDir(hyperframesCacheDir("node-compile-cache"), hyperframesCacheDir());
  } catch (error) {
    // expected: a cache folder another account can change, or one that cannot be made, runs without the cache
    if (error instanceof CacheFolderNotPrivate || (error instanceof Error && "code" in error))
      return undefined;
    throw error;
  }
  enable(dir);
  return dir;
}
