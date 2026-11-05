import { createInterface } from "node:readline/promises";
import { openBrowser } from "../auth/browser.js";
import {
  addonBlocks,
  checkoutSkill,
  createCheckout,
  money,
  pageUrl,
  readOffer,
  readPlan,
  CheckoutError,
  type Offer,
  type Plan,
} from "../heygen/plan.js";
import { c } from "../ui/colors.js";
import { trackBillingCheckoutFailed, trackBillingWaitTimeout } from "../telemetry/events.js";
import { failCommand, setCommandExitCode } from "../utils/commandResult.js";
import { isUnattended } from "../utils/attendedTerminal.js";
import { defineCommand } from "../utils/defineCommand.js";

const describe = (p: Plan | null) =>
  p && p.plan !== "none" ? `${p.plan} plan, ${p.credits.toLocaleString("en-US")} credits` : "Free";

function priceLine(
  kind: "plans" | "credits",
  offer: Offer,
  missing?: number,
  needed?: number,
): string | undefined {
  if (kind === "plans")
    return offer.pro
      ? `HyperFrames Pro: ${money(offer.pro.amount, offer.pro.currency)} a month`
      : undefined;
  const a = offer.addon;
  if (!a) return undefined;
  const blocks = addonBlocks(a, missing);
  const credits = (blocks * a.unitsPerBlock).toLocaleString("en-US");
  const price = money(blocks * a.unitAmount, a.currency);
  return `${needed ? `This run needs ${needed.toLocaleString("en-US")} credits. ` : ""}${credits} add-on credits: ${price}`;
}

const WAIT_TIMEOUT_EXIT = 124;

type CheckoutSource = { skill?: string; baseline?: number };

async function openCheckout(
  kind: "plans" | "credits",
  offer: Offer,
  missing: number | undefined,
  signal: AbortSignal,
  source: CheckoutSource,
): Promise<void> {
  if (isUnattended()) {
    console.log(`Checkout link: ${c.accent(await createCheckout(kind, offer, missing, source))}`);
    return;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    await rl.question("Press Enter to pay ", { signal });
  } finally {
    rl.close();
  }
  await openBrowser(await createCheckout(kind, offer, missing, source));
}

async function offerCheckout(
  kind: "plans" | "credits",
  before: Plan | null,
  signal: AbortSignal,
  needed: number | undefined,
  source: CheckoutSource,
): Promise<CheckoutError | null> {
  const offer = await readOffer();
  const missing = needed ? needed - (before?.credits ?? 0) : undefined;
  const line = priceLine(kind, offer, missing, needed);
  if (line) console.log(line);
  try {
    await openCheckout(kind, offer, missing, signal, source);
    return null;
  } catch (error) {
    if (signal.aborted) return null;
    console.error(c.error(error instanceof Error ? error.message : String(error)));
    if (!(error instanceof CheckoutError)) return null;
    trackBillingCheckoutFailed({ reason: error.reason });
    return error;
  }
}

/** Opens the plans or credits page, then waits until the account shows the change, so the run continues on its own. */
export default defineCommand({
  meta: {
    name: "billing",
    description:
      "Open the HyperFrames plans page (subscribe) or buy add-on credits, used separately from your plan's monthly credits (add-credits), and wait until the person is done",
  },
  args: {
    action: { type: "positional", description: "subscribe | add-credits", required: true },
    needed: {
      type: "string",
      description: "Credits the waiting step needs (add-credits waits until the balance covers it)",
    },
    tool: { type: "string", description: "The step that is waiting, shown on the page" },
    feature: {
      type: "string",
      description: "The feature that sent the person here, so a purchase is credited to it",
    },
    session: { type: "string", description: "The run to credit the purchase to (with --feature)" },
    skill: {
      type: "string",
      description:
        "The skill that sent the person here, sent with the pricing link (default: the project's own skill)",
    },
    timeout: { type: "string", description: "Seconds to wait (default 600)" },
  },
  // fallow-ignore-next-line complexity
  async run({ args }) {
    const action = String(args.action);
    if (action !== "subscribe" && action !== "add-credits") {
      console.error(c.error("Use `billing subscribe` or `billing add-credits`."));
      failCommand();
    }
    const needed = Number(args.needed) || undefined;
    const skill = checkoutSkill(args.skill);
    const before = await readPlan();
    const done = (p: Plan | null) =>
      action === "subscribe"
        ? !!p && p.plan !== "none"
        : !!p && p.plan !== "none" && p.credits >= (needed ?? (before?.credits ?? 0) + 1);
    if (done(before) && (action === "subscribe" || needed)) {
      console.log(c.success(`✓ Already covered: ${describe(before)}.`));
      return;
    }
    const url = await pageUrl(action === "subscribe" ? "plans" : "credits", {
      needed,
      tool: args.tool,
      feature: args.feature,
      rs: args.session,
      skill,
    });
    console.log(`${action === "subscribe" ? "Plans" : "Credits"} page: ${c.accent(url)}`);
    await openBrowser(url);
    const deadline = Date.now() + (Number(args.timeout) || 600) * 1000;
    const stop = new AbortController();
    const giveUp = new AbortController();
    const waiting = (async () => {
      while (Date.now() < deadline && !giveUp.signal.aborted) {
        await new Promise((r) => setTimeout(r, 2000));
        const now = await readPlan();
        if (done(now)) return now;
      }
      return null;
    })().finally(() => stop.abort());
    const checkoutFailure = await offerCheckout(
      action === "subscribe" ? "plans" : "credits",
      before,
      stop.signal,
      needed,
      { skill, baseline: before?.credits },
    );
    if (checkoutFailure?.reason === "checkout_unavailable") {
      giveUp.abort();
      failCommand();
    }
    console.log("Waiting for the person to finish ...");
    const now = await waiting;
    if (now) {
      console.log(c.success(`✓ Done: ${describe(now)}. Carry on.`));
      return;
    }
    console.error(
      c.error(
        `Still waiting on the ${action === "subscribe" ? "plans" : "credits"} page; run this again once it is done.`,
      ),
    );
    if (checkoutFailure) failCommand();
    trackBillingWaitTimeout({ action });
    setCommandExitCode(WAIT_TIMEOUT_EXIT);
  },
});
