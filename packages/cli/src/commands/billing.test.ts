import { runCommand } from "citty";
import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeCommandResult } from "../utils/commandResult.js";
import type { Plan } from "../heygen/plan.js";

const opened = vi.hoisted(() => [] as string[]);
const checkouts = vi.hoisted(() => [] as { kind: string; missing?: number }[]);
const state = vi.hoisted(() => ({ plans: [] as (Plan | null)[], unattended: true, enters: 0 }));

vi.mock("../auth/browser.js", () => ({
  openBrowser: async (url: string) => void opened.push(url),
}));
vi.mock("../utils/attendedTerminal.js", () => ({ isUnattended: () => state.unattended }));
vi.mock("node:readline/promises", () => ({
  createInterface: () => ({
    question: async () => void state.enters++,
    close: () => undefined,
  }),
}));
vi.mock("../heygen/plan.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../heygen/plan.js")>();
  return {
    ...real,
    readPlan: async () => (state.plans.length ? state.plans.shift()! : pro(1_000_000)),
    readOffer: async () => ({
      pro: { amount: 2500, currency: "usd" },
      addon: {
        unitsPerBlock: 1000,
        unitAmount: 100,
        currency: "usd",
        min: 1,
        max: 100,
        recommended: 25,
      },
    }),
    createCheckout: async (kind: string, _offer: unknown, missing?: number) => {
      checkouts.push({ kind, missing });
      return "https://checkout.stripe.com/c/pay/cs_test_1";
    },
  };
});

const free: Plan = { plan: "none", credits: 0 };
const pro = (credits: number): Plan => ({ plan: "pro", credits });

const { default: billing } = await import("./billing.js");

afterEach(() => {
  opened.length = 0;
  checkouts.length = 0;
  state.enters = 0;
  vi.restoreAllMocks();
  consumeCommandResult();
});

async function billingRun(
  plans: (Plan | null)[],
  unattended: boolean,
  rawArgs: string[] = ["subscribe"],
) {
  state.plans = plans;
  state.unattended = unattended;
  const logged: string[] = [];
  vi.spyOn(console, "log").mockImplementation((line: string) => void logged.push(line));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.useFakeTimers();
  const done = runCommand(billing, { rawArgs });
  await vi.advanceTimersByTimeAsync(2000);
  await done;
  vi.useRealTimers();
  return logged.join("\n");
}

describe("billing subscribe", () => {
  it("opens the plans page credited to the feature and run that sent the person", async () => {
    await billingRun([free, pro(0)], true, [
      ...["subscribe", "--feature", "reverse", "--session", "rvs_abc"],
    ]);
    const url = new URL(opened[0] ?? "");
    expect(url.searchParams.get("feature")).toBe("reverse");
    expect(url.searchParams.get("rs")).toBe("rvs_abc");
  });

  it("prints the price and the checkout link when nobody is at the terminal", async () => {
    const out = await billingRun([free, pro(0)], true);
    expect(out).toContain("HyperFrames Pro: $25.00 a month");
    expect(out).toContain("https://checkout.stripe.com/c/pay/cs_test_1");
    expect(checkouts).toEqual([{ kind: "plans" }]);
  });

  it("opens Stripe's checkout on Enter", async () => {
    await billingRun([free, free, pro(0)], false);
    expect(checkouts).toEqual([{ kind: "plans" }]);
    expect(opened.at(-1)).toBe("https://checkout.stripe.com/c/pay/cs_test_1");
  });

  it("opens no second checkout when the person already paid on the page before Enter", async () => {
    await billingRun([free, pro(0)], false);
    expect(checkouts).toEqual([]);
    expect(opened).toHaveLength(1);
  });

  it("opens no checkout when the plan cannot be read on Enter", async () => {
    const out = await billingRun([free, null, pro(0)], false);
    expect(checkouts).toEqual([]);
    expect(out).toContain("Could not read your plan");
  });
});

describe("billing top-up", () => {
  it("shows the new price and asks again when the balance moved before Enter", async () => {
    const out = await billingRun([pro(0), pro(6000), pro(6000), pro(10_000)], false, [
      ...["top-up", "--needed", "10000"],
    ]);
    expect(out).toContain("10,000 credits: $10.00");
    expect(out).toContain("4,000 credits: $4.00");
    expect(state.enters).toBe(2);
    expect(checkouts).toEqual([{ kind: "credits", missing: 4000 }]);
  });
});
