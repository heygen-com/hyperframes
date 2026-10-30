/**
 * HyperFrames credentials are isolated from the HeyGen CLI and between environments.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { oauthEnvironment } from "./config.js";

/**
 * Filename for the HyperFrames credential store (JSON, no extension).
 */
export const CREDENTIAL_FILENAME = "credentials";

export function configDir(): string {
  const root = process.env["HYPERFRAMES_CONFIG_DIR"] || join(homedir(), ".hyperframes");
  return oauthEnvironment() === "dev" ? join(root, "dev") : root;
}

export function credentialPath(): string {
  return join(configDir(), CREDENTIAL_FILENAME);
}
