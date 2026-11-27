import { PREVIEW_NONCE_HEADER, previewProof } from "@hyperframes/core/preview-proof";
export type PreviewConfigEnv = Record<string, string | undefined>;
type ConfigRequest = Pick<import("node:http").IncomingMessage, "headers" | "socket">;

function signed(config: Record<string, unknown>, req?: ConfigRequest) {
  const { localAddress: address, localPort: port } = req?.socket ?? {};
  const nonce = req?.headers[PREVIEW_NONCE_HEADER];
  const proof = address && port ? previewProof(nonce, { address, port }, config) : null;
  return proof ? { ...config, proof } : null;
}

export function previewConfigPayload(
  env: PreviewConfigEnv,
  pid = process.pid,
  version = "dev",
  req?: ConfigRequest,
): Record<string, unknown> | null {
  const projectDir = env.HYPERFRAMES_PREVIEW_PROJECT_DIR;
  const projectName = env.HYPERFRAMES_PREVIEW_PROJECT_NAME;
  // A Studio started by hand serves many projects: it proves only that it is this user's, never a project.
  if (!projectDir || !projectName) return signed({ isStudio: true }, req);

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
  return signed(config, req) ?? config;
}
