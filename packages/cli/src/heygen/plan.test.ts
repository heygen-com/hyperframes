import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../cloud/auth.js", () => ({
  resolveCloudAuthHeaders: async () => ({ "x-api-key": "k" }),
  resolveCloudBaseUrl: () => "https://api.example.test",
}));
const returnRefused = vi.hoisted(() => vi.fn());
vi.mock("../telemetry/events.js", () => ({ trackBillingCheckoutReturnRefused: returnRefused }));

const {
  addonBlocks,
  checkoutSkill,
  cliCheckoutLink,
  createCheckout,
  pageUrl,
  readOffer,
  readPlan,
  stripeCheckoutUrl,
} = await import("./plan.js");

const asked: string[] = [];
const answer = (data: unknown) =>
  vi.stubGlobal("fetch", async (url: string) => {
    asked.push(url);
    return new Response(JSON.stringify({ code: 100, data }));
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("readPlan", () => {
  it("reads the plan the way the subscription route sends it", async () => {
    answer({
      subscription: { plan_name: "pro", status: "active" },
      usage: { remaining_units: 25000 },
    });
    expect(await readPlan()).toEqual({ plan: "pro", credits: 25000 });
    expect(asked.at(-1)).toBe("https://api2.example.test/v1/payment/hyperframes/subscription");
    answer({ subscription: null, usage: { remaining_units: 0 } });
    expect(await readPlan()).toEqual({ plan: "none", credits: 0 });
    answer({
      subscription: { plan_name: "pro", status: "incomplete" },
      usage: { remaining_units: 0 },
    });
    expect((await readPlan())?.plan).toBe("none");
  });
});

const SPACE = "abcdef0123456789abcdef0123456789";
const signedInAs = (space: unknown) => answer({ space_info: { space_id: space } });
const signedOut = () => vi.stubGlobal("fetch", async () => new Response("{}", { status: 401 }));

describe("pageUrl", () => {
  it("links the web app for HYPERFRAMES_ENV and tells the page the buyer came from the CLI", async () => {
    signedOut();
    vi.stubEnv("HYPERFRAMES_PLANS_URL", "");
    vi.stubEnv("HYPERFRAMES_CREDITS_URL", "");
    vi.stubEnv("HYPERFRAMES_ENV", "prod");
    expect(await pageUrl("plans")).toBe(
      "https://hyperframes.studio/pricing?from=cli&utm_source=cli",
    );
    expect(await pageUrl("credits")).toBe(
      "https://hyperframes.studio/pricing?from=cli&utm_source=cli#packs",
    );
    expect(await pageUrl("plans", { feature: "reverse", rs: "rvs_x" })).toBe(
      "https://hyperframes.studio/pricing?from=cli&utm_source=cli&feature=reverse&rs=rvs_x",
    );
    expect(await pageUrl("credits", { needed: 180, tool: "reverse" })).toBe(
      "https://hyperframes.studio/pricing?from=cli&utm_source=cli&needed_credits=180&tool=reverse#packs",
    );
    vi.stubEnv("HYPERFRAMES_ENV", "dev");
    expect(await pageUrl("plans")).toBe(
      "https://hyperframes.studio/pricing?from=cli&utm_source=cli",
    );
    vi.stubEnv("HYPERFRAMES_PLANS_URL", "https://example.test/plans");
    expect(await pageUrl("plans")).toBe("https://example.test/plans?from=cli&utm_source=cli");
  });

  it("carries the workspace the sign-in is bound to on every link, read from account.get", async () => {
    signedInAs(SPACE);
    vi.stubEnv("HYPERFRAMES_PLANS_URL", "");
    vi.stubEnv("HYPERFRAMES_CREDITS_URL", "");
    for (const kind of ["plans", "credits"] as const) {
      const url = new URL(await pageUrl(kind, { needed: 5 }));
      expect(url.searchParams.get("workspace_hint")).toBe(SPACE);
      expect(url.searchParams.get("from")).toBe("cli");
    }
    expect(asked.at(-1)).toBe("https://api2.example.test/v1/pacific/account.get");
  });

  it("carries none when signed out, when the read fails, or when the id is not a workspace id", async () => {
    signedOut();
    expect(new URL(await pageUrl("plans")).searchParams.has("workspace_hint")).toBe(false);
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    expect(new URL(await pageUrl("plans")).searchParams.has("workspace_hint")).toBe(false);
    for (const bad of ["a/../b", "", 7, "x".repeat(65)]) {
      signedInAs(bad);
      expect(new URL(await pageUrl("plans")).searchParams.has("workspace_hint")).toBe(false);
    }
  });
});

const PLANS = {
  plans: [
    { plan_name: "pro", period: "month", amount: 4200, currency: "usd", monthly_units: 42000 },
  ],
  addons_enabled: true,
  addon: {
    units_per_block: 1000,
    unit_amount: 100,
    currency: "usd",
    min_quantity: 1,
    max_quantity: 100,
    recommended: 25,
  },
};

describe("readOffer", () => {
  it("reads Pro's price and the credit block offer", async () => {
    answer(PLANS);
    const offer = await readOffer();
    expect(offer.pro).toEqual({ amount: 4200, currency: "usd" });
    expect(offer.addon).toMatchObject({ unitsPerBlock: 1000, unitAmount: 100, recommended: 25 });
    answer({ ...PLANS, addons_enabled: false });
    expect((await readOffer()).addon).toBeUndefined();
  });
});

describe("addonBlocks", () => {
  it("rounds the missing credits up to blocks, within the offer's limits", async () => {
    answer(PLANS);
    const addon = (await readOffer()).addon!;
    expect(addonBlocks(addon, 2500)).toBe(3);
    expect(addonBlocks(addon, 5_000_000)).toBe(100);
    expect(addonBlocks(addon)).toBe(25);
  });
});

describe("stripeCheckoutUrl", () => {
  it("opens only Stripe's own checkout page", () => {
    expect(stripeCheckoutUrl("https://checkout.stripe.com/c/pay/cs_test_1")).toBe(
      "https://checkout.stripe.com/c/pay/cs_test_1",
    );
    for (const bad of [
      "http://checkout.stripe.com/c/pay/x",
      "https://checkout.stripe.com.evil.test/c/pay/x",
      "https://evil.test/?u=checkout.stripe.com",
      "javascript:alert(1)",
      42,
    ])
      expect(stripeCheckoutUrl(bad)).toBeUndefined();
  });
});

describe("createCheckout", () => {
  it("sends no checkout once the wait it belongs to has ended", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchImpl);
    const stop = new AbortController();
    stop.abort();
    await expect(
      createCheckout("plans", { pro: { amount: 2900, currency: "usd" } }, undefined, {
        stop: stop.signal,
      }),
    ).rejects.toBeDefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("asks for Pro with the CLI's own token and returns Stripe's page", async () => {
    const sent: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
      sent.push({ url, body: JSON.parse(init.body) });
      return new Response(
        JSON.stringify({ data: { url: "https://checkout.stripe.com/c/pay/cs_test_1" } }),
      );
    });
    expect(await createCheckout("plans", {})).toBe("https://checkout.stripe.com/c/pay/cs_test_1");
    expect(sent[0]!.url).toBe("https://api2.example.test/v1/payment/hyperframes/checkout");
    expect(sent[0]!.body).toMatchObject({ plan_name: "pro", period: "month" });
  });

  it("asks for the credit blocks the offer showed, and refuses a page that is not Stripe's", async () => {
    answer(PLANS);
    const offer = await readOffer();
    const sent: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ data: { url: "https://evil.test/pay" } }));
    });
    await expect(createCheckout("credits", offer, 2500)).rejects.toThrow(
      /would not open a checkout/,
    );
    expect(sent[0]).toEqual({ quantity: 3, currency: "usd", unit_amount: 100 });
  });
});

describe("where a purchase came from", () => {
  const project = (skill: unknown) => {
    const dir = mkdtempSync(join(tmpdir(), "hf-plan-"));
    writeFileSync(join(dir, "hyperframes.json"), JSON.stringify({ authoringSkill: skill }));
    return dir;
  };

  it("names the skill passed in, else the project's own, never a non-slug", () => {
    expect(checkoutSkill("style-sampling", project("hyperframes"))).toBe("style-sampling");
    expect(checkoutSkill(undefined, project("hyperframes"))).toBe("hyperframes");
    expect(checkoutSkill("not a slug", project("hyperframes"))).toBe("hyperframes");
    expect(checkoutSkill(undefined, project("../etc"))).toBeUndefined();
    expect(checkoutSkill(undefined, mkdtempSync(join(tmpdir(), "hf-plan-")))).toBeUndefined();
  });

  it("puts the skill on the plans page", async () => {
    signedOut();
    vi.stubEnv("HYPERFRAMES_PLANS_URL", "");
    expect(await pageUrl("plans", { skill: "media-use" })).toBe(
      "https://hyperframes.studio/pricing?from=cli&utm_source=cli&skill=media-use",
    );
  });

  it("marks the server's own pricing link as the CLI's, keeping what it already says", () => {
    expect(cliCheckoutLink("https://hyperframes.studio/pricing?feature=reverse&rs=1", "x")).toBe(
      "https://hyperframes.studio/pricing?feature=reverse&rs=1&from=cli&skill=x&utm_source=cli",
    );
    expect(cliCheckoutLink("https://hyperframes.studio/pricing?from=desktop&skill=y", "x")).toBe(
      "https://hyperframes.studio/pricing?from=desktop&skill=y&utm_source=cli",
    );
    expect(cliCheckoutLink("https://pay.test/credits", "x")).toBe("https://pay.test/credits");
  });

  it("sends a terminal Pro checkout back to the plans page marked as the CLI's, with the skill", async () => {
    vi.stubEnv("HYPERFRAMES_PLANS_URL", "");
    const sent: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body));
      return new Response(
        JSON.stringify({ data: { url: "https://checkout.stripe.com/c/pay/cs_test_2" } }),
      );
    });
    await createCheckout("plans", {}, undefined, { skill: "style-sampling", baseline: 120 });
    expect(sent[0]!.return_url).toBe(
      "https://hyperframes.studio/pricing?from=cli&skill=style-sampling&checkout=pro&from_credits=120",
    );
  });

  it("still sells Pro, without the return page, when the server does not allow it", async () => {
    const sent: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      sent.push(body);
      return body.return_url
        ? new Response(
            JSON.stringify({ code: 400, message: "This return address is not allowed" }),
            {
              status: 400,
            },
          )
        : new Response(
            JSON.stringify({ data: { url: "https://checkout.stripe.com/c/pay/cs_test_3" } }),
          );
    });
    expect(await createCheckout("plans", {})).toBe("https://checkout.stripe.com/c/pay/cs_test_3");
    expect(sent).toHaveLength(2);
    expect(sent[1]).not.toHaveProperty("return_url");
    expect(sent[1]!.request_id).not.toBe(sent[0]!.request_id);
    expect(returnRefused).toHaveBeenCalledTimes(1);
  });

  it("does not retry any other refusal", async () => {
    returnRefused.mockClear();
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      return new Response(JSON.stringify({ message: "HyperFrames purchases are unavailable" }), {
        status: 400,
      });
    });
    await expect(createCheckout("plans", {})).rejects.toThrow(/purchases are unavailable/);
    expect(calls).toBe(1);
    expect(returnRefused).not.toHaveBeenCalled();
  });
});
