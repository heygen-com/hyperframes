import { homedir } from "node:os";
import { join } from "node:path";

export function hyperframesConfigDir(...parts: string[]): string {
  return join(process.env["HYPERFRAMES_CONFIG_DIR"] || join(homedir(), ".hyperframes"), ...parts);
}
