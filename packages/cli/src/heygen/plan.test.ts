import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../cloud/auth.js", () => ({
  resolveCloudAuthHeaders: async () => ({ "x-api-key": "k" }),
  resolveCloudBaseUrl: () => "https://api.example.test",
}));

const { addonBlocks, createCheckout, pageUrl, readOffer, readPlan, stripeCheckoutUrl } =
  await import("./plan.js");

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
    expect(await pageUrl("plans")).toBe("https://hyperframes.studio/pricing?from=cli");
    expect(await pageUrl("credits")).toBe("https://hyperframes.studio/pricing?from=cli#packs");
    expect(await pageUrl("plans", { feature: "reverse", rs: "rvs_x" })).toBe(
      "https://hyperframes.studio/pricing?from=cli&feature=reverse&rs=rvs_x",
    );
    expect(await pageUrl("credits", { needed: 180, tool: "reverse" })).toBe(
      "https://hyperframes.studio/pricing?from=cli&needed_credits=180&tool=reverse#packs",
    );
    vi.stubEnv("HYPERFRAMES_ENV", "dev");
    expect(await pageUrl("plans")).toBe("https://hyperframes.studio/pricing?from=cli");
    vi.stubEnv("HYPERFRAMES_PLANS_URL", "https://example.test/plans");
    expect(await pageUrl("plans")).toBe("https://example.test/plans?from=cli");
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
