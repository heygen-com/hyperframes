export type PreviewConfigEnv = Record<string, string | undefined>;

export function previewConfigPayload(
  env: PreviewConfigEnv,
  pid = process.pid,
  version = "dev",
): Record<string, unknown> | null {
  const projectDir = env.HYPERFRAMES_PREVIEW_PROJECT_DIR;
  const projectName = env.HYPERFRAMES_PREVIEW_PROJECT_NAME;
  if (!projectDir || !projectName) return null;

  const browserGpuMode = env.HYPERFRAMES_PREVIEW_BROWSER_GPU_MODE;
  return {
    isHyperframes: true,
    pid,
    projectName,
    projectDir,
    serverBuildSignature: null,
    ...(browserGpuMode ? { browserGpuMode } : {}),
    version,
  };
}
