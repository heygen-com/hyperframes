import { runCommand } from "citty";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consumeCommandResult } from "../utils/commandResult.js";

const opened = vi.hoisted(() => [] as string[]);
const plan = vi.hoisted(() => ({ calls: 0 }));
const terminal = vi.hoisted(() => ({
  attended: false,
  checkouts: 0,
  checkoutError: null as unknown,
  args: [] as unknown[][],
}));
const events = vi.hoisted(() => ({ failed: [] as unknown[], timeout: [] as unknown[] }));
const never = vi.hoisted(() => ({ paid: true }));

vi.mock("../telemetry/events.js", () => ({
  trackBillingCheckoutFailed: (p: unknown) => void events.failed.push(p),
  trackBillingWaitTimeout: (p: unknown) => void events.timeout.push(p),
}));

vi.mock("../utils/attendedTerminal.js", () => ({ isUnattended: () => !terminal.attended }));
vi.mock("node:readline/promises", () => ({
  createInterface: () => ({
    question: (_q: string, opts: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) =>
        opts.signal.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        ),
      ),
    close: () => undefined,
  }),
}));

vi.mock("../auth/browser.js", () => ({
  openBrowser: async (url: string) => void opened.push(url),
}));
vi.mock("../cloud/auth.js", () => ({
  resolveCloudAuthHeaders: async () => ({ "x-api-key": "k" }),
  resolveCloudBaseUrl: () => "https://api.example.test",
}));
vi.mock("../heygen/plan.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../heygen/plan.js")>();
  return {
    ...real,
    readOffer: async () => ({}),
    createCheckout: async (...args: unknown[]) => {
      if (terminal.checkoutError) throw terminal.checkoutError;
      terminal.checkouts++;
      terminal.args.push(args);
      return "https://checkout.stripe.com/c/pay/cs_test_1";
    },
    readPlan: async () => ({
      plan: ++plan.calls === 1 || !never.paid ? "none" : "pro",
      credits: plan.calls === 1 || !never.paid ? 0 : 500,
    }),
  };
});

const { default: billing } = await import("./billing.js");

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    async () => new Response(JSON.stringify({ data: { space_info: { space_id: "sp-1" } } })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  opened.length = 0;
  plan.calls = 0;
  terminal.attended = false;
  terminal.checkouts = 0;
  terminal.args.length = 0;
  terminal.checkoutError = null;
  events.failed.length = 0;
  events.timeout.length = 0;
  never.paid = true;
  vi.restoreAllMocks();
  consumeCommandResult();
});

describe("billing subscribe", () => {
  it("opens the plans page credited to the feature and run that sent the person", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.useFakeTimers();
    const done = runCommand(billing, {
      rawArgs: ["subscribe", "--feature", "reverse", "--session", "rvs_abc"],
    });
    await vi.advanceTimersByTimeAsync(2000);
    await done;
    vi.useRealTimers();
    const url = new URL(opened[0] ?? "");
    expect(url.searchParams.get("feature")).toBe("reverse");
    expect(url.searchParams.get("rs")).toBe("rvs_abc");
    expect(url.searchParams.get("workspace_hint")).toBe("sp-1");
  });

  it("names the skill that sent the person on the page and on the terminal checkout", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.useFakeTimers();
    const done = runCommand(billing, {
      rawArgs: ["subscribe", "--feature", "templates", "--skill", "style-sampling"],
    });
    await vi.advanceTimersByTimeAsync(2000);
    await done;
    vi.useRealTimers();
    const url = new URL(opened[0] ?? "");
    expect(url.searchParams.get("from")).toBe("cli");
    expect(url.searchParams.get("skill")).toBe("style-sampling");
    expect(terminal.args).toEqual([
      ["plans", {}, undefined, { skill: "style-sampling", baseline: 0 }],
    ]);
  });
});

describe("billing add-credits", () => {
  it("opens the credits page", async () => {
    vi.stubEnv("HYPERFRAMES_PLANS_URL", "https://plans.test/p");
    vi.stubEnv("HYPERFRAMES_CREDITS_URL", "https://credits.test/c");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.useFakeTimers();
    const done = runCommand(billing, { rawArgs: ["add-credits"] });
    await vi.advanceTimersByTimeAsync(2000);
    await done;
    vi.useRealTimers();
    vi.unstubAllEnvs();
    expect(new URL(opened[0] ?? "").origin).toBe("https://credits.test");
    expect(error).not.toHaveBeenCalled();
    expect(log.mock.calls.flat().join("\n")).not.toMatch(/deprecat|renamed|top-up/i);
  });

  it("refuses the old name `top-up` like any unknown action, naming the valid ones", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(runCommand(billing, { rawArgs: ["top-up"] })).rejects.toThrow();
    expect(error.mock.calls.flat().join("\n")).toContain(
      "Use `billing subscribe` or `billing add-credits`.",
    );
    expect(opened).toEqual([]);
  });
});

describe("billing without a terminal", () => {
  it("prints Stripe's checkout link instead of waiting for Enter, and opens only the pricing page", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.useFakeTimers();
    const done = runCommand(billing, { rawArgs: ["subscribe"] });
    await vi.advanceTimersByTimeAsync(2000);
    await done;
    vi.useRealTimers();
    expect(log.mock.calls.flat().join("\n")).toContain(
      "Checkout link: https://checkout.stripe.com/c/pay/cs_test_1",
    );
    expect(opened.map((u) => new URL(u).hostname)).toEqual(["hyperframes.studio"]);
  });
});

describe("billing at a terminal", () => {
  it("finishes when the purchase lands while Press Enter is still waiting, and makes no second checkout", async () => {
    terminal.attended = true;
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.useFakeTimers();
    const done = runCommand(billing, { rawArgs: ["subscribe"] });
    await vi.advanceTimersByTimeAsync(2000);
    await done;
    vi.useRealTimers();
    expect(terminal.checkouts).toBe(0);
    expect(opened.map((u) => new URL(u).hostname)).toEqual(["hyperframes.studio"]);
  });
});

describe("billing outcomes", () => {
  it("keeps waiting after a failed checkout, because the open pricing page can still take the payment", async () => {
    const { CheckoutError } = await import("../heygen/plan.js");
    terminal.checkoutError = new CheckoutError("checkout_network", "https://x.test/secret failed");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.useFakeTimers();
    const done = runCommand(billing, { rawArgs: ["subscribe"] });
    await vi.advanceTimersByTimeAsync(2000);
    await done;
    vi.useRealTimers();
    expect(events.failed).toEqual([{ reason: "checkout_network" }]);
    expect(log.mock.calls.flat().join("\n")).toContain("Done");
  });

  it("fails with the checkout error, not as a timeout, when the checkout failed and nobody paid", async () => {
    const { CheckoutError } = await import("../heygen/plan.js");
    terminal.checkoutError = new CheckoutError("checkout_rejected", "HeyGen would not open it");
    never.paid = false;
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.useFakeTimers();
    const done = runCommand(billing, { rawArgs: ["subscribe", "--timeout", "4"] });
    const settled = expect(done).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(6000);
    await settled;
    vi.useRealTimers();
    expect(events.failed).toEqual([{ reason: "checkout_rejected" }]);
    expect(events.timeout).toEqual([]);
  });

  it("stops at once when credits are not on sale, since the credits page cannot sell them either", async () => {
    const { CheckoutError } = await import("../heygen/plan.js");
    terminal.checkoutError = new CheckoutError("checkout_unavailable", "Credits are not on sale");
    never.paid = false;
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(runCommand(billing, { rawArgs: ["subscribe"] })).rejects.toThrow();
    expect(events.failed).toEqual([{ reason: "checkout_unavailable" }]);
  });

  it("ends a wait with no payment as wait_timeout, not a checkout failure or a failed command", async () => {
    never.paid = false;
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.useFakeTimers();
    const done = runCommand(billing, { rawArgs: ["subscribe", "--timeout", "4"] });
    await vi.advanceTimersByTimeAsync(6000);
    await done;
    vi.useRealTimers();
    expect(events.timeout).toEqual([{ action: "subscribe" }]);
    expect(events.failed).toEqual([]);
    expect(error.mock.calls.flat().join("\n")).toContain("Still waiting");
    expect(consumeCommandResult().exitCode).toBe(124);
  });

  it("emits no event when the payment lands", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.useFakeTimers();
    const done = runCommand(billing, { rawArgs: ["subscribe"] });
    await vi.advanceTimersByTimeAsync(2000);
    await done;
    vi.useRealTimers();
    expect(events.failed).toEqual([]);
    expect(events.timeout).toEqual([]);
  });
});
