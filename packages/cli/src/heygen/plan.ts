// The HyperFrames plan and credits the signed-in account holds, and the web pages that change them.
import { oauthEnvironment } from "../auth/config.js";
import { resolveCloudAuthHeaders, resolveCloudBaseUrl } from "../cloud/auth.js";

export interface Plan {
  plan: string;
  credits: number;
  mock?: boolean;
}

const UNPAID = new Set(["incomplete", "incomplete_expired"]);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// ponytail: HYPERFRAMES_MOCK_PLAN="pro:25000" | "none" stands in when the server will not answer the CLI client
// (EF admits only the Desktop client today); drop it once the CLI client is registered.
function mockPlan(): Plan | null {
  const raw = process.env["HYPERFRAMES_MOCK_PLAN"]?.trim();
  if (!raw) return null;
  const [plan = "none", credits = "0"] = raw.split(":");
  return { plan, credits: Number(credits) || 0, mock: true };
}

// Payment routes live on api2, beside the OAuth ones; the v3 generation routes stay on api.
const billingBaseUrl = () => resolveCloudBaseUrl().replace("://api.", "://api2.");

export async function readPlan(): Promise<Plan | null> {
  try {
    const res = await fetch(`${billingBaseUrl()}/v1/payment/hyperframes/subscription`, {
      headers: { ...(await resolveCloudAuthHeaders()), accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    const body: unknown = await res.json().catch(() => null);
    const data = isRecord(body) && isRecord(body.data) ? body.data : body;
    if (!res.ok || !isRecord(data)) return mockPlan();
    const usage = isRecord(data.usage) ? data.usage : {};
    // studio-contracts' BillingSubscription: `subscription` is null on Free; an unpaid placeholder still names a plan.
    const sub = isRecord(data.subscription) ? data.subscription : null;
    const paid = !!sub && !UNPAID.has(String(sub.status));
    return {
      plan: paid ? String(sub.plan_name ?? "paid") : "none",
      credits: Number(usage.remaining_units ?? 0) || 0,
    };
  } catch {
    return mockPlan();
  }
}

const webBase = () =>
  oauthEnvironment() === "dev" ? "https://dev.hyperframes.dev" : "https://hyperframes.studio";
const plansUrl = () => process.env["HYPERFRAMES_PLANS_URL"] || `${webBase()}/pricing`;
const creditsUrl = () => process.env["HYPERFRAMES_CREDITS_URL"] || `${webBase()}/plan`;

/** A plans or credits page link with what the web side reads: `from=cli`, the credits needed, the waiting step. */
export function pageUrl(
  kind: "plans" | "credits",
  fields: { needed?: number; tool?: string; base?: string } = {},
): string {
  const url = new URL(fields.base ?? (kind === "plans" ? plansUrl() : creditsUrl()));
  url.searchParams.set("from", "cli");
  if (fields.needed) url.searchParams.set("needed_credits", String(fields.needed));
  if (fields.tool) url.searchParams.set("tool", fields.tool);
  return url.toString();
}
