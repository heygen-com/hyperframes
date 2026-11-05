// The reverse session the server opens when a reverse run starts, and the plan it read for the account.
import { resolveCloudAuthHeaders, resolveCloudBaseUrl } from "../cloud/auth.js";
import { trackReverseStartUnrecorded, type ReverseUnrecordedCause } from "../telemetry/events.js";
import { normalizeReverseSessionId } from "../utils/projectConfig.js";
import { cliCheckoutLink, pageUrl, readPlan } from "./plan.js";

const SKILL = "reverse-any-video";

export type ReversePlan = "free" | "pro" | "unknown";
export type ReverseGate = "record" | "block";
export type ReverseSurface = "cli" | "desktop";

export interface ReverseSession {
  sessionId: string;
  plan: ReversePlan;
  gate: ReverseGate;
  upgradeUrl?: string | null;
}

export type ReverseStart =
  | { recorded: true; session: ReverseSession }
  | {
      recorded: false;
      reason: "not_signed_in" | "unavailable";
      cause?: ReverseUnrecordedCause;
      plan?: "free" | "pro";
    };

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
  const url = data.upgrade_url;
  const upgradeUrl = typeof url === "string" || url === null ? { upgradeUrl: url } : {};
  return { sessionId, plan, gate, ...upgradeUrl };
}

/** The plan from the subscription route, for when the reverse route cannot answer. */
async function fallbackPlan(): Promise<"free" | "pro" | undefined> {
  const plan = await readPlan();
  if (!plan) return undefined;
  return plan.plan === "none" ? "free" : "pro";
}

/** The link that credits a purchase to this run: the server's (null: none can be bought), else the plans page. */
export async function reverseUpgradeUrl(session?: {
  sessionId: string;
  upgradeUrl?: string | null;
}): Promise<string | null> {
  if (session?.upgradeUrl === null) return null;
  if (session?.upgradeUrl) return cliCheckoutLink(session.upgradeUrl, SKILL);
  return pageUrl("plans", { feature: "reverse", rs: session?.sessionId, skill: SKILL });
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
    trackReverseStartUnrecorded({ cause: "not_signed_in" });
    return { recorded: false, reason: "not_signed_in" };
  }
  let cause: ReverseUnrecordedCause;
  let status: number | undefined;
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
    if (res.ok) {
      const session = parseSession(await res.json().catch(() => null));
      if (session) return { recorded: true, session };
      cause = "bad_body";
    } else {
      status = res.status;
      cause = res.status >= 500 ? "http_5xx" : res.status >= 400 ? "http_4xx" : "http_other";
    }
  } catch {
    cause = "network";
  }
  trackReverseStartUnrecorded({ cause, status });
  const plan = await fallbackPlan().catch(() => undefined);
  return { recorded: false, reason: "unavailable", cause, ...(plan ? { plan } : {}) };
}
