import { createInterface } from "node:readline/promises";
import { terminalLines, terminalText } from "@hyperframes/core";
import { openBrowser } from "../auth/browser.js";
import {
  addonBlocks,
  checkoutSkill,
  createCheckout,
  MANAGE_LABEL,
  money,
  pageUrl,
  readOffer,
  readPlan,
  signInToOwnSpace,
  CheckoutError,
  type Offer,
  type Plan,
} from "../heygen/plan.js";
import { c } from "../ui/colors.js";
import { trackBillingCheckoutFailed, trackBillingWaitTimeout } from "../telemetry/events.js";
import { failCommand, setCommandExitCode } from "../utils/commandResult.js";
import { isRemoteOrHeadless, isUnattended } from "../utils/attendedTerminal.js";
import { parsePositiveIntegerArg } from "../utils/integerArg.js";
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

function refuseUnreadCheckout(): null {
  console.error(
    c.error(
      "Could not read this account's plan, so no checkout opens from here. Finish on the page.",
    ),
  );
  return null;
}

type CheckoutSource = { skill?: string; baseline?: number };

type Measured = { baseline: number } | null;

type AtEnter = () => Promise<{ covered: true } | { covered: false; missing?: number }>;

async function openCheckout(
  kind: "plans" | "credits",
  offer: Offer,
  missing: number | undefined,
  signal: AbortSignal,
  source: CheckoutSource & { atEnter: AtEnter; needed?: number },
): Promise<void> {
  const { atEnter, needed, ...from } = source;
  if (isUnattended()) {
    const link = await createCheckout(kind, offer, missing, { ...from, stop: signal });
    if (!signal.aborted) console.log(`Checkout link: ${c.accent(terminalText(link))}`);
    return;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    await rl.question("Press Enter to pay here (not if you already paid on the page) ", { signal });
  } finally {
    rl.close();
  }
  if (signal.aborted) return;
  const fresh = await atEnter();
  if (signal.aborted) return;
  if (fresh.covered) {
    console.log("The page has taken the payment, so no second checkout opens.");
    return;
  }
  const line = priceLine(kind, offer, fresh.missing, needed);
  if (line && line !== priceLine(kind, offer, missing, needed)) console.log(terminalText(line));
  const link = await createCheckout(kind, offer, fresh.missing, { ...from, stop: signal });
  if (!signal.aborted) await openBrowser(link);
}

type PlanInOwnSpaceOrNull = () => Promise<Plan | null>;

const signInHere = (error: unknown, deadline: number) =>
  error instanceof CheckoutError &&
  error.reason === "checkout_team_role" &&
  !isUnattended() &&
  !isRemoteOrHeadless() &&
  deadline > Date.now();

async function offerCheckout(
  kind: "plans" | "credits",
  before: Plan,
  signal: AbortSignal,
  needed: number | undefined,
  source: CheckoutSource & { deadline: number },
  done: (p: Plan | null) => boolean,
  ownSpace?: PlanInOwnSpaceOrNull,
): Promise<CheckoutError | null> {
  if (kind === "credits" && before.plan === "none") return null;
  const { deadline, ...from } = source;
  const offer = await readOffer(signal);
  if (signal.aborted) return null;
  const shortBy = (p: Plan) => (needed ? needed - p.credits : undefined);
  const missing = shortBy(before);
  const line = priceLine(kind, offer, missing, needed);
  if (line) console.log(terminalText(line));
  const atEnter: AtEnter = async () => {
    const now = await readPlan(signal);
    if (done(now)) return { covered: true };
    return { covered: false, missing: now ? shortBy(now) : missing };
  };
  try {
    await openCheckout(kind, offer, missing, signal, { ...from, atEnter, needed });
    return null;
  } catch (error) {
    if (signal.aborted) return null;
    if (!ownSpace || !signInHere(error, deadline)) return reportCheckoutFailure(error);
    return buyInOwnSpace(error, ownSpace, signal, done, (there) =>
      offerCheckout(kind, there, signal, needed, { ...source, baseline: there.credits }, done),
    );
  }
}

async function buyInOwnSpace(
  refusal: unknown,
  ownSpace: PlanInOwnSpaceOrNull,
  signal: AbortSignal,
  done: (p: Plan | null) => boolean,
  offerThere: (there: Plan) => Promise<CheckoutError | null>,
): Promise<CheckoutError | null> {
  console.log(
    "Only this team's admin can buy its plan. Sign in to your own workspace to buy it there.",
  );
  const there = await ownSpace().catch(() => null);
  if (signal.aborted) return null;
  if (!there) return reportCheckoutFailure(refusal);
  if (done(there)) {
    console.log(
      `Your own workspace already covers this (${terminalText(describe(there))}), so no checkout opens.`,
    );
    return null;
  }
  console.log(`Signed in to your own workspace: ${terminalText(describe(there))}.`);
  return offerThere(there);
}

async function readPlanBefore(stop: AbortSignal): Promise<Plan | null> {
  for (let attempt = 1; ; attempt++) {
    const plan = await readPlan(stop);
    if (plan || attempt === 3 || stop.aborted) return plan;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

function reportCheckoutFailure(error: unknown): CheckoutError | null {
  console.error(c.error(terminalLines(error instanceof Error ? error.message : String(error))));
  if (!(error instanceof CheckoutError)) return null;
  trackBillingCheckoutFailed({ reason: error.reason });
  return error;
}

async function showPlan(open: boolean): Promise<void> {
  const plan = await readPlan();
  console.log(`HyperFrames: ${plan ? terminalText(describe(plan)) : "plan unavailable"}`);
  if (plan?.plan === "none" && !open) return;
  const url = await pageUrl("manage");
  console.log(`${MANAGE_LABEL} ${c.accent(terminalText(url))}`);
  if (open && !isUnattended()) await openBrowser(url);
}

/** Opens the plans or credits page, then waits until the account shows the change, so the run continues on its own. */
export default defineCommand({
  meta: {
    name: "billing",
    description:
      "Show your HyperFrames plan and where to manage or cancel it (--manage opens that page), open the plans page (subscribe) or buy add-on credits, used separately from your plan's monthly credits (add-credits), and wait until the person is done",
  },
  args: {
    action: { type: "positional", description: "subscribe | add-credits", required: false },
    manage: {
      type: "boolean",
      description:
        "Open the page to manage or cancel your plan (prints the link when no one is at the terminal)",
    },
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
    if (args.action === undefined) return showPlan(args.manage === true);
    const action = String(args.action);
    if (action !== "subscribe" && action !== "add-credits") {
      console.error(c.error("Use `billing subscribe` or `billing add-credits`."));
      failCommand();
    }
    const needed = parsePositiveIntegerArg(args.needed, "--needed");
    const timeoutSeconds =
      parsePositiveIntegerArg(args.timeout, "--timeout", { unit: "seconds" }) ?? 600;
    const skill = checkoutSkill(args.skill);
    const deadline = Date.now() + timeoutSeconds * 1000;
    const stop = new AbortController();
    const atDeadline = setTimeout(() => stop.abort(), deadline - Date.now());
    atDeadline.unref?.();
    const before = await readPlanBefore(stop.signal);
    let measured: Measured = { baseline: before?.credits ?? 0 };
    const done = (p: Plan | null, m = measured) =>
      !!m &&
      !!p &&
      p.plan !== "none" &&
      (action === "subscribe" || p.credits >= (needed ?? m.baseline + 1));
    let landedElsewhere = false;
    const ownSpace: PlanInOwnSpaceOrNull = async () => {
      let switched = false;
      const landed = await signInToOwnSpace(deadline - Date.now(), stop.signal, () => {
        switched = true;
        measured = null;
      });
      if (!switched) return null;
      if (!landed) {
        landedElsewhere = true;
        console.error(
          c.error("That sign-in went to another workspace, not your own; nothing was bought."),
        );
        return null;
      }
      const there = await readPlan(stop.signal);
      if (there) measured = { baseline: there.credits };
      return there;
    };
    if (done(before) && (action === "subscribe" || needed)) {
      console.log(c.success(`✓ Already covered: ${terminalText(describe(before))}.`));
      return;
    }
    const url = await pageUrl(action === "subscribe" ? "plans" : "credits", {
      needed,
      tool: args.tool,
      feature: args.feature,
      rs: args.session,
      skill,
    });
    console.log(
      `${action === "subscribe" ? "Plans" : "Credits"} page: ${c.accent(terminalText(url))}`,
    );
    await openBrowser(url);
    const giveUp = new AbortController();
    const waiting = (async () => {
      while (!stop.signal.aborted && !giveUp.signal.aborted) {
        await new Promise((r) => setTimeout(r, 2000));
        const m: Measured = measured;
        const now = m && (await readPlan(stop.signal));
        if (m === measured && done(now, m)) return now;
      }
      return null;
    })().finally(() => {
      clearTimeout(atDeadline);
      stop.abort();
    });
    const checkoutFailure = before
      ? await offerCheckout(
          action === "subscribe" ? "plans" : "credits",
          before,
          stop.signal,
          needed,
          { skill, baseline: before.credits, deadline },
          done,
          ownSpace,
        )
      : refuseUnreadCheckout();
    if (checkoutFailure?.reason === "checkout_unavailable" || landedElsewhere) {
      giveUp.abort();
      failCommand();
    }
    console.log("Waiting for the person to finish ...");
    const now = await waiting;
    if (now) {
      console.log(c.success(`✓ Done: ${terminalText(describe(now))}. Carry on.`));
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
