/**
 * Path resolution utilities for the render pipeline.
 */

import { resolve, basename, join } from "node:path";

export interface RenderPaths {
  absoluteProjectDir: string;
  absoluteOutputPath: string;
}

const DEFAULT_RENDERS_DIR =
  process.env.PRODUCER_RENDERS_DIR ??
  resolve(new URL(import.meta.url).pathname, "../../..", "renders");

export function resolveRenderPaths(
  projectDir: string,
  outputPath: string | null | undefined,
  rendersDir: string = DEFAULT_RENDERS_DIR,
): RenderPaths {
  const absoluteProjectDir = resolve(projectDir);
  const projectName = basename(absoluteProjectDir);
  const resolvedOutputPath = outputPath ?? join(rendersDir, `${projectName}.mp4`);
  const absoluteOutputPath = resolve(resolvedOutputPath);

  return { absoluteProjectDir, absoluteOutputPath };
}
