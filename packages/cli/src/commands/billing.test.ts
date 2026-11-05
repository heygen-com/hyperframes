import { runCommand } from "citty";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consumeCommandResult } from "../utils/commandResult.js";

const opened = vi.hoisted(() => [] as string[]);
const plan = vi.hoisted(() => ({ calls: 0 }));
const terminal = vi.hoisted(() => ({ attended: false, checkouts: 0, enter: false }));
const held = vi.hoisted(() => ({
  offer: undefined as Promise<object> | undefined,
  checkout: undefined as Promise<string> | undefined,
  realOffer: false,
  headerCalls: 0,
  holdHeadersAfter: undefined as number | undefined,
  neverPaid: false,
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
    createCheckout: async () => {
      terminal.checkouts++;
      return held.checkout ?? "https://checkout.stripe.com/c/pay/cs_test_1";
    },
    readPlan: async () => ({
      plan: ++plan.calls === 1 || held.neverPaid ? "none" : "pro",
      credits: plan.calls === 1 ? 0 : 500,
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
  terminal.enter = false;
  Object.assign(held, {
    offer: undefined,
    checkout: undefined,
    realOffer: false,
    headerCalls: 0,
    holdHeadersAfter: undefined,
    neverPaid: false,
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
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const checkout = release<string>();
    held.checkout = checkout.promise;
    vi.useFakeTimers();
    const done = runCommand(billing, { rawArgs: ["subscribe"] });
    await vi.advanceTimersByTimeAsync(2000);
    checkout.resolve("https://checkout.stripe.com/c/pay/cs_late");
    await done;
    vi.useRealTimers();
    expect(opened.map((u) => new URL(u).hostname)).toEqual(["hyperframes.studio"]);
  });

  it("ends at --timeout while the price read is still unanswered", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    held.realOffer = true;
    held.neverPaid = true;
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
