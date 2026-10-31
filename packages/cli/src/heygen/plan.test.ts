import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../cloud/auth.js", () => ({
  resolveCloudAuthHeaders: async () => ({ "x-api-key": "k" }),
  resolveCloudBaseUrl: () => "https://api.dev.heygen.com",
}));

const { pageUrl, readPlan } = await import("./plan.js");

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
    expect(asked.at(-1)).toBe("https://api2.dev.heygen.com/v1/payment/hyperframes/subscription");
    answer({ subscription: null, usage: { remaining_units: 0 } });
    expect(await readPlan()).toEqual({ plan: "none", credits: 0 });
    answer({
      subscription: { plan_name: "pro", status: "incomplete" },
      usage: { remaining_units: 0 },
    });
    expect((await readPlan())?.plan).toBe("none");
  });
});

describe("pageUrl", () => {
  it("links the web app for HYPERFRAMES_ENV and tells the page the buyer came from the CLI", () => {
    vi.stubEnv("HYPERFRAMES_PLANS_URL", "");
    vi.stubEnv("HYPERFRAMES_CREDITS_URL", "");
    vi.stubEnv("HYPERFRAMES_ENV", "prod");
    expect(pageUrl("plans")).toBe("https://hyperframes.studio/pricing?from=cli");
    expect(pageUrl("credits")).toBe("https://hyperframes.studio/plan?from=cli");
    vi.stubEnv("HYPERFRAMES_ENV", "dev");
    expect(pageUrl("plans")).toBe("https://dev.hyperframes.dev/pricing?from=cli");
    expect(pageUrl("credits", { needed: 180, tool: "reverse" })).toBe(
      "https://dev.hyperframes.dev/plan?from=cli&needed_credits=180&tool=reverse",
    );
  });
});
