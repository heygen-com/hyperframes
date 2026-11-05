/**
 * HyperFrames credentials are isolated from the HeyGen CLI and between environments.
 */

import { join } from "node:path";
import { hyperframesConfigDir } from "../utils/configDir.js";
import { oauthEnvironment } from "./config.js";

/**
 * Filename for the HyperFrames credential store (JSON, no extension).
 */
export const CREDENTIAL_FILENAME = "credentials";

export function configDir(): string {
  const root = hyperframesConfigDir();
  return oauthEnvironment() === "dev" ? join(root, "dev") : root;
}

export function credentialPath(): string {
  return join(configDir(), CREDENTIAL_FILENAME);
}
