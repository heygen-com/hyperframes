import { createInterface } from "node:readline/promises";
import { openBrowser } from "../auth/browser.js";
import {
  addonBlocks,
  createCheckout,
  money,
  pageUrl,
  readOffer,
  readPlan,
  type Offer,
  type Plan,
} from "../heygen/plan.js";
import { c } from "../ui/colors.js";
import { failCommand } from "../utils/commandResult.js";
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
  return `${needed ? `This run needs ${needed.toLocaleString("en-US")} credits. ` : ""}${credits} credits: ${price}`;
}

type Done = (p: Plan | null) => boolean;

const readFromTheServer = (p: Plan | null): p is Plan => !!p && !p.mock;
const NO_PLAN = "Could not read your plan, so no checkout opened. Finish on the page.";
const NO_PRICE = "Could not read the price, so no checkout opened. Finish on the page.";

async function payOrShowTheNewPrice(
  kind: "plans" | "credits",
  done: Done,
  shown: string,
  stop: AbortSignal,
  needed?: number,
): Promise<string | undefined> {
  const now = await readPlan(stop);
  if (stop.aborted) return undefined;
  if (!readFromTheServer(now)) return void console.log(NO_PLAN);
  if (done(now)) return undefined;
  const offer = await readOffer(stop);
  if (stop.aborted) return undefined;
  const missing = needed ? needed - now.credits : undefined;
  const line = priceLine(kind, offer, missing, needed);
  if (!line) return void console.log(NO_PRICE);
  if (line !== shown) {
    console.log(line);
    return line;
  }
  const link = await createCheckout(kind, offer, missing, stop);
  if (!stop.aborted) await openBrowser(link);
  return undefined;
}

async function checkoutOnEnterAtTheCurrentPrice(
  kind: "plans" | "credits",
  done: Done,
  shown: string,
  stop: AbortSignal,
  needed?: number,
) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (let price: string | undefined = shown; price; ) {
      await rl.question("Press Enter to pay, or finish on the page ", { signal: stop });
      price = await payOrShowTheNewPrice(kind, done, price, stop, needed);
    }
  } catch (error) {
    if (!stop.aborted) throw error;
    console.log();
  } finally {
    rl.close();
  }
}

async function printTheCheckoutLink(
  kind: "plans" | "credits",
  offer: Offer,
  stop: AbortSignal,
  missing?: number,
) {
  const link = await createCheckout(kind, offer, missing, stop);
  if (!stop.aborted) console.log(`Checkout link: ${c.accent(link)}`);
}

async function offerCheckoutOrPrintTheLink(
  kind: "plans" | "credits",
  before: Plan | null,
  done: Done,
  stop: AbortSignal,
  needed?: number,
) {
  if (!readFromTheServer(before)) return void console.log(NO_PLAN);
  const offer = await readOffer(stop);
  if (stop.aborted) return;
  const missing = needed ? needed - before.credits : undefined;
  const line = priceLine(kind, offer, missing, needed);
  if (!line) return void console.log(NO_PRICE);
  console.log(line);
  try {
    await (isUnattended()
      ? printTheCheckoutLink(kind, offer, stop, missing)
      : checkoutOnEnterAtTheCurrentPrice(kind, done, line, stop, needed));
  } catch (error) {
    if (!stop.aborted)
      console.error(c.error(error instanceof Error ? error.message : String(error)));
  }
}

/** Opens the plans or credits page, then waits until the account shows the change, so the run continues on its own. */
export default defineCommand({
  meta: {
    name: "billing",
    description:
      "Open the HyperFrames plans or credits page and wait until the person is done (subscribe | top-up)",
  },
  args: {
    action: { type: "positional", description: "subscribe | top-up", required: true },
    needed: {
      type: "string",
      description: "Credits the waiting step needs (top-up waits until the balance covers it)",
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
    if (action !== "subscribe" && action !== "top-up") {
      console.error(c.error("Use `billing subscribe` or `billing top-up`."));
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
    const url = pageUrl(action === "subscribe" ? "plans" : "credits", {
      needed,
      tool: args.tool,
      feature: args.feature,
      rs: args.session,
    });
    console.log(`${action === "subscribe" ? "Plans" : "Credits"} page: ${c.accent(url)}`);
    await openBrowser(url);
    console.log("Waiting for the person to finish ...");
    const stop = new AbortController();
    const paying = offerCheckoutOrPrintTheLink(
      action === "subscribe" ? "plans" : "credits",
      before,
      done,
      stop.signal,
      needed,
    );
    const deadline = Date.now() + (Number(args.timeout) || 600) * 1000;
    let now: Plan | null = null;
    while (!done(now) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      now = await readPlan();
    }
    stop.abort();
    await paying;
    if (done(now)) {
      console.log(c.success(`✓ Done: ${describe(now)}. Carry on.`));
      return;
    }
    console.error(
      c.error(
        `Still waiting on the ${action === "subscribe" ? "plans" : "credits"} page; run this again once it is done.`,
      ),
    );
    failCommand();
  },
});
