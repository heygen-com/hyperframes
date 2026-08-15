export function studioProxyEnv(
  autoProxy: boolean,
  baseEnv: NodeJS.ProcessEnv = process.env,
  preview?: {
    projectDir: string;
    projectName: string;
    browserGpuMode?: "auto" | "hardware" | "software";
  },
): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    HYPERFRAMES_AUTO_PROXY: autoProxy ? "true" : "false",
    ...(preview
      ? {
          HYPERFRAMES_PREVIEW_PROJECT_DIR: preview.projectDir,
          HYPERFRAMES_PREVIEW_PROJECT_NAME: preview.projectName,
          ...(preview.browserGpuMode
            ? { HYPERFRAMES_PREVIEW_BROWSER_GPU_MODE: preview.browserGpuMode }
            : {}),
        }
      : {}),
  };
}
