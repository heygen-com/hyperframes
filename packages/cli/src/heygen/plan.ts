// The HyperFrames plan and credits the signed-in account holds, and the web pages that change them.
import { randomUUID } from "node:crypto";
import { resolveCloudAuthHeaders, resolveCloudBaseUrl } from "../cloud/auth.js";
import { trackBillingCheckoutReturnRefused } from "../telemetry/events.js";
import { normalizeSkillSlug } from "../telemetry/skill.js";
import { readProjectConfig } from "../utils/projectConfig.js";

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
export const billingBaseUrl = () => resolveCloudBaseUrl().replace("://api.", "://api2.");

const timeoutOrStop = (ms: number, stop?: AbortSignal) =>
  stop ? AbortSignal.any([stop, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);

// A token refresh can't take the stop signal: overlapping callers share the one in-flight refresh.
async function authHeadersUnlessStopped(stop?: AbortSignal): Promise<Record<string, string>> {
  if (!stop) return resolveCloudAuthHeaders();
  stop.throwIfAborted();
  const headers = await Promise.race([
    resolveCloudAuthHeaders(),
    new Promise<never>((_, reject) =>
      stop.addEventListener("abort", () => reject(stop.reason), { once: true }),
    ),
  ]);
  stop.throwIfAborted();
  return headers;
}

async function getBilling(route: string, stop?: AbortSignal) {
  const res = await fetch(`${billingBaseUrl()}/v1/payment/hyperframes/${route}`, {
    headers: { ...(await authHeadersUnlessStopped(stop)), accept: "application/json" },
    signal: timeoutOrStop(15_000, stop),
  });
  const body: unknown = await res.json().catch(() => null);
  return { res, data: isRecord(body) && isRecord(body.data) ? body.data : body };
}

export async function readPlan(stop?: AbortSignal): Promise<Plan | null> {
  try {
    const { res, data } = await getBilling("subscription", stop);
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

async function signedInSpace(): Promise<string | undefined> {
  try {
    const res = await fetch(`${billingBaseUrl()}/v1/pacific/account.get`, {
      headers: { ...(await resolveCloudAuthHeaders()), accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    });
    const body: unknown = await res.json().catch(() => null);
    const data = isRecord(body) && isRecord(body.data) ? body.data : null;
    const id = data && isRecord(data.space_info) ? data.space_info.space_id : undefined;
    return typeof id === "string" && /^[a-zA-Z0-9-]{1,64}$/.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

export function checkoutSkill(named?: unknown, projectDir = process.cwd()): string | undefined {
  return normalizeSkillSlug(named) ?? readProjectConfig(projectDir)?.authoringSkill;
}

export function cliCheckoutLink(link: string, skill = checkoutSkill()): string {
  if (!URL.canParse(link)) return link;
  const url = new URL(link);
  if (url.hostname !== new URL(webBase()).hostname) return link;
  if (!url.searchParams.has("from")) url.searchParams.set("from", "cli");
  if (skill && !url.searchParams.has("skill")) url.searchParams.set("skill", skill);
  if (!url.searchParams.has("utm_source")) url.searchParams.set("utm_source", "cli");
  return url.toString();
}

/** A plans or credits page link with what the web side reads, incl. the signed-in `workspace_hint`. */
export async function pageUrl(
  kind: "plans" | "credits",
  fields: {
    needed?: number;
    tool?: string;
    feature?: string;
    rs?: string;
    skill?: string;
    base?: string;
  } = {},
): Promise<string> {
  const url = new URL(fields.base ?? (kind === "plans" ? plansUrl() : creditsUrl()));
  url.searchParams.set("from", "cli");
  url.searchParams.set("utm_source", "cli");
  const skill = checkoutSkill(fields.skill);
  if (skill) url.searchParams.set("skill", skill);
  if (fields.needed) url.searchParams.set("needed_credits", String(fields.needed));
  if (fields.tool) url.searchParams.set("tool", fields.tool);
  if (fields.feature) url.searchParams.set("feature", fields.feature);
  if (fields.rs) url.searchParams.set("rs", fields.rs);
  if (kind === "credits" && !fields.base) url.hash = "packs";
  const space = await signedInSpace();
  if (space) url.searchParams.set("workspace_hint", space);
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
    const { res, data } = await getBilling("plans", stop);
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

export type CheckoutFailure = "checkout_unavailable" | "checkout_network" | "checkout_rejected";

/** A checkout that could not be opened, tagged with a closed reason for telemetry. */
export class CheckoutError extends Error {
  constructor(
    readonly reason: CheckoutFailure,
    message: string,
  ) {
    super(message);
    this.name = "CheckoutError";
  }
}

// `from=cli` on the return page is how a purchase made from the terminal is told apart from one made on the site.
function cliCheckoutReturn(skill?: string, baseline?: number): string {
  const url = new URL(plansUrl());
  url.searchParams.set("from", "cli");
  if (skill) url.searchParams.set("skill", skill);
  url.searchParams.set("checkout", "pro");
  url.searchParams.set("from_credits", String(Math.max(0, Math.trunc(baseline ?? 0))));
  return url.toString();
}

const RETURN_REFUSED = /return address is not allowed/i;

/** Creates the checkout with the CLI's own token and returns Stripe's page; throws when HeyGen refuses. */
export async function createCheckout(
  kind: "plans" | "credits",
  offer: Offer,
  missing?: number,
  source: { skill?: string; baseline?: number; stop?: AbortSignal } = {},
): Promise<string> {
  const addon = kind === "credits" ? offer.addon : undefined;
  if (kind === "credits" && !addon)
    throw new CheckoutError(
      "checkout_unavailable",
      "Credits are not on sale for this account right now.",
    );
  if (addon)
    return postCheckout(
      "addon.checkout",
      {
        quantity: addonBlocks(addon, missing),
        currency: addon.currency,
        unit_amount: addon.unitAmount,
      },
      source.stop,
    );
  const pro = () => ({ plan_name: "pro", period: "month", request_id: randomUUID() });
  const returnUrl = cliCheckoutReturn(checkoutSkill(source.skill), source.baseline);
  try {
    return await postCheckout("checkout", { ...pro(), return_url: returnUrl }, source.stop);
  } catch (error) {
    // A server whose allow-list lacks the plans page still sells Pro, only without the CLI's origin.
    const refused = error instanceof CheckoutError && error.reason === "checkout_rejected";
    if (!refused || !RETURN_REFUSED.test(error.message)) throw error;
    trackBillingCheckoutReturnRefused();
    return postCheckout("checkout", pro(), source.stop);
  }
}

async function postCheckout(
  route: string,
  body: Record<string, unknown>,
  stop?: AbortSignal,
): Promise<string> {
  const res = await fetch(`${billingBaseUrl()}/v1/payment/hyperframes/${route}`, {
    method: "POST",
    headers: {
      ...(await authHeadersUnlessStopped(stop)),
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: timeoutOrStop(20_000, stop),
  }).catch((error: unknown) => {
    throw new CheckoutError(
      "checkout_network",
      `Could not reach HeyGen to open a checkout: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
  const reply: unknown = await res.json().catch(() => null);
  const data = isRecord(reply) && isRecord(reply.data) ? reply.data : reply;
  const url = res.ok && isRecord(data) ? stripeCheckoutUrl(data.url) : undefined;
  if (url) return url;
  const why =
    isRecord(reply) && typeof reply.message === "string"
      ? reply.message.slice(0, 200)
      : `HTTP ${res.status}`;
  throw new CheckoutError("checkout_rejected", `HeyGen would not open a checkout: ${why}`);
}
