import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function loadBrowserScript(name: string): string {
  const candidates = [join(__dirname, name), join(__dirname, "commands", name)];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return readFileSync(candidate, "utf-8");
  }
  throw new Error(`Missing browser script ${name}`);
}
