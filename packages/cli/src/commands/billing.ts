import { createInterface } from "node:readline/promises";
import { openBrowser } from "../auth/browser.js";
import {
  addonBlocks,
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

async function offerCheckout(
  kind: "plans" | "credits",
  before: Plan | null,
  signal: AbortSignal,
  needed?: number,
): Promise<boolean> {
  const offer = await readOffer();
  const missing = needed ? needed - (before?.credits ?? 0) : undefined;
  const line = priceLine(kind, offer, missing, needed);
  if (line) console.log(line);
  try {
    if (isUnattended()) {
      console.log(`Checkout link: ${c.accent(await createCheckout(kind, offer, missing))}`);
      return true;
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      await rl.question("Press Enter to pay ", { signal });
    } finally {
      rl.close();
    }
    await openBrowser(await createCheckout(kind, offer, missing));
    return true;
  } catch (error) {
    if (signal.aborted) return true;
    console.error(c.error(error instanceof Error ? error.message : String(error)));
    trackBillingCheckoutFailed({
      reason: error instanceof CheckoutError ? error.reason : "checkout_unavailable",
    });
    return false;
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
    const opened = await offerCheckout(
      action === "subscribe" ? "plans" : "credits",
      before,
      stop.signal,
      needed,
    );
    if (!opened) {
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
    // Exit 124 (timeout): the person did not finish, which is not a failed command or a cli_error.
    trackBillingWaitTimeout({ action });
    setCommandExitCode(124);
  },
});
