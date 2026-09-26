import { promises as dns } from "node:dns";

const PROBE_TIMEOUT_MS = 1000;

/**
 * Whether DNS answers for `host` via c-ares, one short try. The system lookup `fetch` makes cannot
 * be aborted and holds even `process.exit`, so background requests ask this first.
 */
export async function hostAnswers(host: string): Promise<boolean> {
  const resolver = new dns.Resolver({ timeout: PROBE_TIMEOUT_MS, tries: 1 });
  try {
    await Promise.any([resolver.resolve4(host), resolver.resolve6(host)]);
    return true;
  } catch {
    return false;
  } finally {
    resolver.cancel();
  }
}
