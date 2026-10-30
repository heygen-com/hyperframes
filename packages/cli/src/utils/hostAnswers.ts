import { promises as dns } from "node:dns";
import { fetchGoesThroughEnvProxy } from "@hyperframes/core/env-proxy";

const PROBE_TIMEOUT_MS = 1000;

/**
 * Whether DNS answers for `host` via c-ares, one short try per nameserver. The system lookup
 * `fetch` makes cannot be aborted and holds even `process.exit`, so background requests ask this first.
 */
export async function hostAnswers(host: string): Promise<boolean> {
  if (fetchGoesThroughEnvProxy()) return true;
  try {
    const resolver = new dns.Resolver({ timeout: PROBE_TIMEOUT_MS, tries: 1 });
    const results = await Promise.allSettled([resolver.resolve4(host), resolver.resolve6(host)]);
    const anyFamilyTimedOut = results.some(
      (r) => r.status === "rejected" && (r.reason as NodeJS.ErrnoException).code === "ETIMEOUT",
    );
    return !anyFamilyTimedOut && results.some((r) => r.status === "fulfilled");
  } catch {
    return false;
  }
}
