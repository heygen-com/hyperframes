// The reverse session the server opens when a reverse run starts, and the plan it read for the account.
import { resolveCloudAuthHeaders, resolveCloudBaseUrl } from "../cloud/auth.js";
import { normalizeReverseSessionId } from "../utils/projectConfig.js";
import { pageUrl, readPlan } from "./plan.js";

export type ReversePlan = "free" | "pro" | "unknown";
export type ReverseGate = "record" | "block";
export type ReverseSurface = "cli" | "desktop";

export interface ReverseSession {
  sessionId: string;
  plan: ReversePlan;
  gate: ReverseGate;
  upgradeUrl?: string;
}

export type ReverseStart =
  | { recorded: true; session: ReverseSession }
  | { recorded: false; reason: "not_signed_in" | "unavailable"; plan?: "free" | "pro" };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const api2BaseUrl = () => resolveCloudBaseUrl().replace("://api.", "://api2.");

export function reverseSurface(env: NodeJS.ProcessEnv = process.env): ReverseSurface {
  return env["HYPERFRAMES_CLIENT"]?.trim() ? "desktop" : "cli";
}

const PLANS: readonly ReversePlan[] = ["free", "pro", "unknown"];
const GATES: readonly ReverseGate[] = ["record", "block"];

function oneOf<T extends string>(value: unknown, options: readonly T[]): T | undefined {
  return options.find((option) => option === value);
}

function parseSession(body: unknown): ReverseSession | undefined {
  const data = isRecord(body) && isRecord(body.data) ? body.data : body;
  if (!isRecord(data)) return undefined;
  const sessionId = normalizeReverseSessionId(data.session_id);
  const plan = oneOf(data.plan, PLANS);
  const gate = oneOf(data.gate, GATES);
  if (!sessionId || !plan || !gate) return undefined;
  const upgradeUrl = typeof data.upgrade_url === "string" ? { upgradeUrl: data.upgrade_url } : {};
  return { sessionId, plan, gate, ...upgradeUrl };
}

/** The plan from the subscription route, for when the reverse route cannot answer. */
async function fallbackPlan(): Promise<"free" | "pro" | undefined> {
  const plan = await readPlan();
  if (!plan) return undefined;
  return plan.plan === "none" ? "free" : "pro";
}

/** The link that credits a purchase to this run: the server's, else the plans page with the same fields. */
export function reverseUpgradeUrl(session?: { sessionId: string; upgradeUrl?: string }): string {
  return session?.upgradeUrl ?? pageUrl("plans", { feature: "reverse", rs: session?.sessionId });
}

/**
 * Open (or resume) a reverse session. Never throws: a run that is not signed in, an older server
 * without the route, or any network or parse failure comes back unrecorded and the run goes on.
 */
export async function startReverseSession(
  opts: { resumeSessionId?: string; surface?: ReverseSurface } = {},
): Promise<ReverseStart> {
  let headers: Record<string, string>;
  try {
    headers = await resolveCloudAuthHeaders();
  } catch {
    return { recorded: false, reason: "not_signed_in" };
  }
  try {
    const res = await fetch(`${api2BaseUrl()}/v1/hyperframes/reverse/start`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        surface: opts.surface ?? reverseSurface(),
        ...(opts.resumeSessionId ? { session_id: opts.resumeSessionId } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const session = res.ok ? parseSession(await res.json().catch(() => null)) : undefined;
    if (session) return { recorded: true, session };
  } catch {
    // Fall through to the unrecorded answer below.
  }
  const plan = await fallbackPlan().catch(() => undefined);
  return { recorded: false, reason: "unavailable", ...(plan ? { plan } : {}) };
}
