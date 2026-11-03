import { runCommand } from "citty";
import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeCommandResult } from "../utils/commandResult.js";

const opened = vi.hoisted(() => [] as string[]);
const checkouts = vi.hoisted(() => [] as string[]);
const state = vi.hoisted(() => ({ plans: [] as string[], unattended: true }));

vi.mock("../auth/browser.js", () => ({
  openBrowser: async (url: string) => void opened.push(url),
}));
vi.mock("../utils/attendedTerminal.js", () => ({ isUnattended: () => state.unattended }));
vi.mock("node:readline/promises", () => ({
  createInterface: () => ({ question: async () => "", close: () => undefined }),
}));
vi.mock("../heygen/plan.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../heygen/plan.js")>();
  return {
    ...real,
    readPlan: async () => ({ plan: state.plans.shift() ?? "pro", credits: 0 }),
    readOffer: async () => ({ pro: { amount: 2500, currency: "usd" } }),
    createCheckout: async (kind: string) => {
      checkouts.push(kind);
      return "https://checkout.stripe.com/c/pay/cs_test_1";
    },
  };
});

const { default: billing } = await import("./billing.js");

afterEach(() => {
  opened.length = 0;
  checkouts.length = 0;
  vi.restoreAllMocks();
  consumeCommandResult();
});

async function subscribe(plans: string[], unattended: boolean, rawArgs: string[] = []) {
  state.plans = plans;
  state.unattended = unattended;
  const logged: string[] = [];
  vi.spyOn(console, "log").mockImplementation((line: string) => void logged.push(line));
  vi.useFakeTimers();
  const done = runCommand(billing, { rawArgs: ["subscribe", ...rawArgs] });
  await vi.advanceTimersByTimeAsync(2000);
  await done;
  vi.useRealTimers();
  return logged.join("\n");
}

describe("billing subscribe", () => {
  it("opens the plans page credited to the feature and run that sent the person", async () => {
    await subscribe(["none", "pro"], true, ["--feature", "reverse", "--session", "rvs_abc"]);
    const url = new URL(opened[0] ?? "");
    expect(url.searchParams.get("feature")).toBe("reverse");
    expect(url.searchParams.get("rs")).toBe("rvs_abc");
  });

  it("prints the price and the checkout link when nobody is at the terminal", async () => {
    const out = await subscribe(["none", "pro"], true);
    expect(out).toContain("HyperFrames Pro: $25.00 a month");
    expect(out).toContain("https://checkout.stripe.com/c/pay/cs_test_1");
    expect(checkouts).toEqual(["plans"]);
  });

  it("opens Stripe's checkout on Enter", async () => {
    await subscribe(["none", "none", "pro"], false);
    expect(checkouts).toEqual(["plans"]);
    expect(opened.at(-1)).toBe("https://checkout.stripe.com/c/pay/cs_test_1");
  });

  it("opens no second checkout when the person already paid on the page before Enter", async () => {
    await subscribe(["none", "pro"], false);
    expect(checkouts).toEqual([]);
    expect(opened).toHaveLength(1);
  });
});
