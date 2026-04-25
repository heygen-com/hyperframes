import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const KEY_NAME = "ELEVENLABS_API_KEY";

function parseDotenv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function readEnvFile(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    const env = parseDotenv(readFileSync(path, "utf-8"));
    return env[KEY_NAME] ?? null;
  } catch {
    return null;
  }
}

/**
 * Look up the ElevenLabs API key. Resolution order:
 *   1. process.env.ELEVENLABS_API_KEY
 *   2. <projectDir>/.env (if projectDir provided)
 *   3. ~/.hyperframes/.env
 */
export function loadElevenLabsKey(projectDir?: string): string | null {
  const fromProcess = process.env[KEY_NAME];
  if (fromProcess) return fromProcess;

  if (projectDir) {
    const fromProject = readEnvFile(join(projectDir, ".env"));
    if (fromProject) return fromProject;
  }

  return readEnvFile(join(homedir(), ".hyperframes", ".env"));
}

export const ELEVENLABS_KEY_NAME = KEY_NAME;
