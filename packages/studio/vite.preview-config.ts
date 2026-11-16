import { previewProof, type PreviewEndpoint } from "@hyperframes/core/preview-proof";
export type PreviewConfigEnv = Record<string, string | undefined>;

export function previewConfigPayload(
  env: PreviewConfigEnv,
  pid = process.pid,
  version = "dev",
  challenge?: { nonce: string | null; endpoint: PreviewEndpoint },
): Record<string, unknown> | null {
  const projectDir = env.HYPERFRAMES_PREVIEW_PROJECT_DIR;
  const projectName = env.HYPERFRAMES_PREVIEW_PROJECT_NAME;
  if (!projectDir || !projectName) return null;

  const browserGpuMode = env.HYPERFRAMES_PREVIEW_BROWSER_GPU_MODE;
  const config = {
    isHyperframes: true,
    pid,
    projectName,
    projectDir,
    serverBuildSignature: null,
    ...(browserGpuMode ? { browserGpuMode } : {}),
    version,
  };
  const proof = challenge && previewProof(challenge.nonce, challenge.endpoint, config);
  return { ...config, ...(proof && { proof }) };
}
