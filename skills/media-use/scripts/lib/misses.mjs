import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MISSES_FILE = "misses.jsonl";

function missesPath() {
  return join(homedir(), ".media", MISSES_FILE);
}

export function recordMiss({ type, intent, provider_override, local_only }) {
  try {
    const dir = join(homedir(), ".media");
    mkdirSync(dir, { recursive: true });
    appendFileSync(
      join(dir, MISSES_FILE),
      JSON.stringify({
        ts: new Date().toISOString(),
        type,
        intent,
        provider_override: !!provider_override,
        local_only: !!local_only,
      }) + "\n",
    );
  } catch {
    // local miss logging is best-effort; never surface into resolve
  }
}

export function readMisses() {
  const p = missesPath();
  try {
    if (!existsSync(p)) return [];
    const raw = readFileSync(p, "utf8");
    const records = [];
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        records.push(JSON.parse(trimmed));
      } catch {
        // skip malformed local lines, don't crash stats
      }
    }
    return records;
  } catch {
    return [];
  }
}
