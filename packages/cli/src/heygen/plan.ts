// The HyperFrames plan and credits the signed-in account holds, and the web pages that change them.
import { randomUUID } from "node:crypto";
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

const timeoutOrStop = (ms: number, stop?: AbortSignal) =>
  stop ? AbortSignal.any([stop, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);

const authHeadersUnlessStopped = (stop?: AbortSignal): Promise<Record<string, string>> =>
  stop
    ? Promise.race([
        resolveCloudAuthHeaders(),
        new Promise<never>((_, reject) => {
          if (stop.aborted) reject(stop.reason);
          stop.addEventListener("abort", () => reject(stop.reason), { once: true });
        }),
      ])
    : resolveCloudAuthHeaders();

export async function readPlan(stop?: AbortSignal): Promise<Plan | null> {
  try {
    const res = await fetch(`${billingBaseUrl()}/v1/payment/hyperframes/subscription`, {
      headers: { ...(await authHeadersUnlessStopped(stop)), accept: "application/json" },
      signal: timeoutOrStop(15_000, stop),
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

const webBase = () => "https://hyperframes.studio";
const plansUrl = () => process.env["HYPERFRAMES_PLANS_URL"] || `${webBase()}/pricing`;
const creditsUrl = () => process.env["HYPERFRAMES_CREDITS_URL"] || `${webBase()}/pricing`;

/** A plans or credits page link with what the web side reads: `from=cli`, the credits needed, the waiting step. */
export function pageUrl(
  kind: "plans" | "credits",
  fields: { needed?: number; tool?: string; feature?: string; rs?: string; base?: string } = {},
): string {
  const url = new URL(fields.base ?? (kind === "plans" ? plansUrl() : creditsUrl()));
  url.searchParams.set("from", "cli");
  if (fields.needed) url.searchParams.set("needed_credits", String(fields.needed));
  if (fields.tool) url.searchParams.set("tool", fields.tool);
  if (fields.feature) url.searchParams.set("feature", fields.feature);
  if (fields.rs) url.searchParams.set("rs", fields.rs);
  if (kind === "credits" && !fields.base) url.hash = "packs";
  return url.toString();
}

/** What checkout sells, as the plans route lists it: Pro's monthly price and the credit block offer (cents). */
export interface Offer {
  pro?: { amount: number; currency: string };
  addon?: {
    unitsPerBlock: number;
    unitAmount: number;
    currency: string;
    min: number;
    max: number;
    recommended: number;
  };
}

const int = (v: unknown) =>
  Number.isSafeInteger(v) && (v as number) > 0 ? (v as number) : undefined;

export async function readOffer(stop?: AbortSignal): Promise<Offer> {
  try {
    const res = await fetch(`${billingBaseUrl()}/v1/payment/hyperframes/plans`, {
      headers: { ...(await authHeadersUnlessStopped(stop)), accept: "application/json" },
      signal: timeoutOrStop(15_000, stop),
    });
    const body: unknown = await res.json().catch(() => null);
    const data = isRecord(body) && isRecord(body.data) ? body.data : body;
    if (!res.ok || !isRecord(data)) return {};
    const plans = Array.isArray(data.plans) ? data.plans.filter(isRecord) : [];
    const pro = plans.find((p) => p.plan_name === "pro" && p.period === "month");
    const a = isRecord(data.addon) && data.addons_enabled === true ? data.addon : null;
    const offer: Offer = {};
    if (pro && int(pro.amount) && typeof pro.currency === "string")
      offer.pro = { amount: int(pro.amount)!, currency: pro.currency };
    const [unitsPerBlock, unitAmount, min, max] = [
      "units_per_block",
      "unit_amount",
      "min_quantity",
      "max_quantity",
    ].map((k) => int(a?.[k]));
    if (a && unitsPerBlock && unitAmount && min && max && typeof a.currency === "string")
      offer.addon = {
        unitsPerBlock,
        unitAmount,
        currency: a.currency,
        min,
        max,
        recommended: int(a.recommended) ?? min,
      };
    return offer;
  } catch {
    return {};
  }
}

/** Blocks to buy so the balance reaches `target` (or the recommended amount), held to the offer's limits. */
export function addonBlocks(offer: NonNullable<Offer["addon"]>, missing?: number): number {
  const blocks =
    missing && missing > 0 ? Math.ceil(missing / offer.unitsPerBlock) : offer.recommended;
  return Math.min(offer.max, Math.max(offer.min, blocks));
}

export const money = (cents: number, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(
    cents / 100,
  );

/** Only Stripe's own checkout page is ever opened from what the server returns. */
export function stripeCheckoutUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !URL.canParse(value)) return undefined;
  const url = new URL(value);
  return url.protocol === "https:" && url.hostname === "checkout.stripe.com"
    ? url.toString()
    : undefined;
}

/** Creates the checkout with the CLI's own token and returns Stripe's page; throws when HeyGen refuses. */
export async function createCheckout(
  kind: "plans" | "credits",
  offer: Offer,
  missing?: number,
  stop?: AbortSignal,
): Promise<string> {
  const addon = kind === "credits" ? offer.addon : undefined;
  if (kind === "credits" && !addon)
    throw new Error("Credits are not on sale for this account right now.");
  const body = addon
    ? {
        quantity: addonBlocks(addon, missing),
        currency: addon.currency,
        unit_amount: addon.unitAmount,
      }
    : { plan_name: "pro", period: "month", request_id: randomUUID() };
  const res = await fetch(
    `${billingBaseUrl()}/v1/payment/hyperframes/${addon ? "addon.checkout" : "checkout"}`,
    {
      method: "POST",
      headers: {
        ...(await authHeadersUnlessStopped(stop)),
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: timeoutOrStop(20_000, stop),
    },
  );
  const reply: unknown = await res.json().catch(() => null);
  const data = isRecord(reply) && isRecord(reply.data) ? reply.data : reply;
  const url = res.ok && isRecord(data) ? stripeCheckoutUrl(data.url) : undefined;
  if (url) return url;
  const why =
    isRecord(reply) && typeof reply.message === "string"
      ? reply.message.slice(0, 200)
      : `HTTP ${res.status}`;
  throw new Error(`HeyGen would not open a checkout: ${why}`);
}
