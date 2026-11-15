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
  enter: false,
}));
const events = vi.hoisted(() => ({ failed: [] as unknown[], timeout: [] as unknown[] }));
const never = vi.hoisted(() => ({ paid: true }));
const held = vi.hoisted(() => ({
  offer: undefined as Promise<object> | undefined,
  checkout: undefined as Promise<string> | undefined,
  realOffer: false,
  headerCalls: 0,
  holdHeadersAfter: undefined as number | undefined,
  stallPoll: false,
  reads: undefined as Array<{ plan: string; credits: number } | null> | undefined,
}));

vi.mock("../telemetry/events.js", () => ({
  trackBillingCheckoutFailed: (p: unknown) => void events.failed.push(p),
  trackBillingWaitTimeout: (p: unknown) => void events.timeout.push(p),
}));

vi.mock("../utils/attendedTerminal.js", () => ({ isUnattended: () => !terminal.attended }));
vi.mock("node:readline/promises", () => ({
  createInterface: () => ({
    question: (_q: string, opts: { signal: AbortSignal }) =>
      new Promise((resolve, reject) =>
        terminal.enter
          ? resolve("")
          : opts.signal.addEventListener("abort", () =>
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
  resolveCloudAuthHeaders: () =>
    held.holdHeadersAfter !== undefined && ++held.headerCalls > held.holdHeadersAfter
      ? new Promise(() => undefined)
      : Promise.resolve({ "x-api-key": "k" }),
  resolveCloudBaseUrl: () => "https://api.example.test",
}));
vi.mock("../heygen/plan.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../heygen/plan.js")>();
  return {
    ...real,
    readOffer: async (stop?: AbortSignal) =>
      held.realOffer ? real.readOffer(stop) : (held.offer ?? {}),
    createCheckout: async (...args: unknown[]) => {
      if (terminal.checkoutError) throw terminal.checkoutError;
      terminal.checkouts++;
      terminal.args.push(args);
      return held.checkout ?? "https://checkout.stripe.com/c/pay/cs_test_1";
    },
    readPlan: async (stop?: AbortSignal) => {
      if (++plan.calls > 1 && held.stallPoll)
        return new Promise((resolve) => stop?.addEventListener("abort", () => resolve(null)));
      if (held.reads) return held.reads[Math.min(plan.calls, held.reads.length) - 1];
      return {
        plan: plan.calls === 1 || !never.paid ? "none" : "pro",
        credits: plan.calls === 1 || !never.paid ? 0 : 500,
      };
    },
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
  terminal.enter = false;
  events.failed.length = 0;
  events.timeout.length = 0;
  never.paid = true;
  Object.assign(held, {
    offer: undefined,
    checkout: undefined,
    realOffer: false,
    headerCalls: 0,
    holdHeadersAfter: undefined,
    stallPoll: false,
    reads: undefined,
  });
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
      [
        "plans",
        {},
        undefined,
        { skill: "style-sampling", baseline: 0, stop: expect.any(AbortSignal) },
      ],
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

describe("billing when the page may already have been paid", () => {
  it("makes no second checkout when Enter is pressed after the page took the payment", async () => {
    terminal.attended = true;
    terminal.enter = true;
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.useFakeTimers();
    const done = runCommand(billing, { rawArgs: ["subscribe"] });
    await vi.advanceTimersByTimeAsync(2000);
    await done;
    vi.useRealTimers();
    expect(terminal.checkouts).toBe(0);
    expect(log.mock.calls.flat().join("\n")).toContain("no second checkout");
  });

  it("buys only what is still short when the page sold part of it before Enter", async () => {
    terminal.attended = true;
    terminal.enter = true;
    never.paid = false;
    held.reads = [
      { plan: "pro", credits: 1000 },
      { plan: "pro", credits: 4000 },
      { plan: "pro", credits: 4000 },
    ];
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.useFakeTimers();
    const done = runCommand(billing, {
      rawArgs: ["add-credits", "--needed", "5000", "--timeout", "4"],
    });
    await vi.advanceTimersByTimeAsync(6000);
    await done;
    vi.useRealTimers();
    expect(terminal.args.map((a) => a[2])).toEqual([1000]);
  });

  it("sells nothing from the terminal when the account's plan cannot be read", async () => {
    never.paid = false;
    held.reads = [null];
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.useFakeTimers();
    const done = runCommand(billing, {
      rawArgs: ["add-credits", "--needed", "5000", "--timeout", "6"],
    });
    await vi.advanceTimersByTimeAsync(8000);
    await done;
    vi.useRealTimers();
    expect(terminal.checkouts).toBe(0);
    expect(error.mock.calls.flat().join("\n")).toContain("Could not read this account's plan");
  });

  it("prices from the balance when the first plan read fails once, not from zero", async () => {
    never.paid = false;
    held.reads = [null, { plan: "pro", credits: 4000 }];
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.useFakeTimers();
    const done = runCommand(billing, {
      rawArgs: ["add-credits", "--needed", "5000", "--timeout", "4"],
    });
    await vi.advanceTimersByTimeAsync(6000);
    await done;
    vi.useRealTimers();
    expect(terminal.args.map((a) => a[2])).toEqual([1000]);
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

function release<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("billing once the wait has ended", () => {
  it("creates no checkout when the purchase lands while the price is still being read", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const offer = release<object>();
    held.offer = offer.promise;
    vi.useFakeTimers();
    const done = runCommand(billing, { rawArgs: ["subscribe"] });
    await vi.advanceTimersByTimeAsync(2000);
    offer.resolve({ pro: { amount: 2900, currency: "usd" } });
    await done;
    vi.useRealTimers();
    expect(terminal.checkouts).toBe(0);
    expect(log.mock.calls.flat().join("\n")).not.toContain("Checkout link");
  });

  it("opens no checkout page when the purchase lands while Enter's checkout is being created", async () => {
    terminal.attended = true;
    terminal.enter = true;
    const free = { plan: "none", credits: 0 };
    held.reads = [free, free, { plan: "pro", credits: 500 }];
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const checkout = release<string>();
    held.checkout = checkout.promise;
    vi.useFakeTimers();
    const done = runCommand(billing, { rawArgs: ["subscribe"] });
    await vi.advanceTimersByTimeAsync(4000);
    checkout.resolve("https://checkout.stripe.com/c/pay/cs_late");
    await done;
    vi.useRealTimers();
    expect(opened.map((u) => new URL(u).hostname)).toEqual(["hyperframes.studio"]);
  });

  it("ends at --timeout while the price read is still unanswered", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    held.realOffer = true;
    never.paid = false;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) =>
      String(url).includes("/hyperframes/plans")
        ? new Promise((_, reject) =>
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
          )
        : new Response(JSON.stringify({ data: { space_info: { space_id: "sp-1" } } })),
    );
    vi.useFakeTimers();
    let settled = false;
    const done = runCommand(billing, { rawArgs: ["subscribe", "--timeout", "4"] }).then(
      () => (settled = true),
      () => (settled = true),
    );
    await vi.advanceTimersByTimeAsync(6000);
    vi.useRealTimers();
    expect(settled).toBe(true);
    await done;
    expect(terminal.checkouts).toBe(0);
  });

  it("creates no checkout after --timeout while a plan poll is still unanswered", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    never.paid = false;
    held.stallPoll = true;
    const offer = release<object>();
    held.offer = offer.promise;
    vi.useFakeTimers();
    let settled = false;
    const done = runCommand(billing, { rawArgs: ["subscribe", "--timeout", "4"] }).then(
      () => (settled = true),
      () => (settled = true),
    );
    await vi.advanceTimersByTimeAsync(6000);
    offer.resolve({ pro: { amount: 2900, currency: "usd" } });
    await vi.advanceTimersByTimeAsync(0);
    vi.useRealTimers();
    expect(terminal.checkouts).toBe(0);
    expect(log.mock.calls.flat().join("\n")).not.toContain("Checkout link");
    expect(settled).toBe(true);
    await done;
  });

  it("ends when the purchase lands while a sign-in refresh is still unanswered", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    held.realOffer = true;
    held.holdHeadersAfter = 1; // the plans page's workspace read answers; the price read's does not
    let settled = false;
    vi.useFakeTimers();
    const done = runCommand(billing, { rawArgs: ["subscribe"] }).then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(2000);
    vi.useRealTimers();
    expect(settled).toBe(true);
    await done;
    expect(terminal.checkouts).toBe(0);
  });
});
