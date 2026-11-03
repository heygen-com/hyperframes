import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ signedIn: true }));

vi.mock("../cloud/auth.js", () => ({
  resolveCloudAuthHeaders: async () => {
    if (!auth.signedIn) throw new Error("NOT_CONFIGURED");
    return { authorization: "Bearer fixture" };
  },
  resolveCloudBaseUrl: () => "https://api.example.test",
}));

const { reverseSurface, reverseUpgradeUrl, startReverseSession } = await import("./reverse.js");

const START_URL = "https://api2.example.test/v1/hyperframes/reverse/start";
const PLAN_URL = "https://api2.example.test/v1/payment/hyperframes/subscription";
const SESSION = "rvs_0f8fad5b-d9cb-469f-a165-70867728950e";

interface Call {
  url: string;
  body?: unknown;
}
let calls: Call[];

function serve(routes: Record<string, () => Response | Promise<Response>>) {
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const route = routes[url];
    if (!route) return new Response("{}", { status: 404 });
    return await route();
  });
}

const freePlan = () => Response.json({ code: 100, data: { subscription: null, usage: {} } });

beforeEach(() => {
  calls = [];
  auth.signedIn = true;
  vi.stubEnv("HYPERFRAMES_CLIENT", "");
  vi.stubEnv("HYPERFRAMES_MOCK_PLAN", "");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("startReverseSession", () => {
  it("opens a session and reads what the server decided", async () => {
    serve({
      [START_URL]: () =>
        Response.json({
          code: 100,
          data: {
            session_id: SESSION,
            plan: "free",
            gate: "record",
            upgrade_url: "https://u.test",
          },
        }),
    });
    expect(await startReverseSession()).toEqual({
      recorded: true,
      session: { sessionId: SESSION, plan: "free", gate: "record", upgradeUrl: "https://u.test" },
    });
    expect(calls).toEqual([{ url: START_URL, body: { surface: "cli" } }]);
  });

  it("sends the saved session back when the run resumes", async () => {
    serve({
      [START_URL]: () => Response.json({ session_id: SESSION, plan: "pro", gate: "record" }),
    });
    const started = await startReverseSession({ resumeSessionId: SESSION });
    expect(started).toMatchObject({ recorded: true, session: { plan: "pro" } });
    expect(calls[0]?.body).toEqual({ surface: "cli", session_id: SESSION });
  });

  it("keeps a session whose plan the server could not read, without reading the plan itself", async () => {
    serve({
      [START_URL]: () =>
        Response.json({
          data: { session_id: SESSION, plan: "unknown", gate: "block", upgrade_url: null },
        }),
      [PLAN_URL]: freePlan,
    });
    expect(await startReverseSession()).toEqual({
      recorded: true,
      session: { sessionId: SESSION, plan: "unknown", gate: "block" },
    });
    expect(calls.map((c) => c.url)).toEqual([START_URL]);
  });

  it("asks nothing when not signed in", async () => {
    auth.signedIn = false;
    serve({});
    expect(await startReverseSession()).toEqual({ recorded: false, reason: "not_signed_in" });
    expect(calls).toEqual([]);
  });

  it("goes on unrecorded when the server has no reverse route yet, with the plan read elsewhere", async () => {
    serve({ [PLAN_URL]: freePlan });
    expect(await startReverseSession()).toEqual({
      recorded: false,
      reason: "unavailable",
      plan: "free",
    });
    expect(calls.map((c) => c.url)).toEqual([START_URL, PLAN_URL]);
  });

  it("goes on unrecorded when the network fails", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    expect(await startReverseSession()).toEqual({ recorded: false, reason: "unavailable" });
  });

  it.each([
    ["no session id", { plan: "pro", gate: "record" }],
    ["a session id that is not an id", { session_id: "../x", plan: "pro", gate: "record" }],
    ["an uppercase session id", { session_id: SESSION.toUpperCase(), plan: "pro", gate: "record" }],
    ["an unknown gate", { session_id: SESSION, plan: "pro", gate: "maybe" }],
    ["an unknown plan", { session_id: SESSION, plan: "team", gate: "record" }],
  ])("treats an answer with %s as unrecorded", async (_label, data) => {
    serve({ [START_URL]: () => Response.json({ data }), [PLAN_URL]: freePlan });
    expect(await startReverseSession()).toMatchObject({ recorded: false, reason: "unavailable" });
  });

  it("treats a server error as unrecorded", async () => {
    serve({ [START_URL]: () => new Response("boom", { status: 500 }) });
    expect(await startReverseSession()).toMatchObject({ recorded: false, reason: "unavailable" });
  });
});

describe("reverseUpgradeUrl", () => {
  it("passes the server's link on as is, else builds the plans page with the fields checkout reads", () => {
    vi.stubEnv("HYPERFRAMES_PLANS_URL", "");
    expect(reverseUpgradeUrl({ sessionId: SESSION, upgradeUrl: "https://u.test/p?rs=1" })).toBe(
      "https://u.test/p?rs=1",
    );
    expect(reverseUpgradeUrl({ sessionId: SESSION })).toBe(
      `https://hyperframes.studio/billing?from=cli&feature=reverse&rs=${SESSION}`,
    );
    expect(reverseUpgradeUrl()).toBe("https://hyperframes.studio/billing?from=cli&feature=reverse");
  });
});

describe("reverseSurface", () => {
  it("is desktop when the Desktop app launched the CLI", () => {
    expect(reverseSurface({})).toBe("cli");
    expect(reverseSurface({ HYPERFRAMES_CLIENT: "desktop/1.2.3/stable" })).toBe("desktop");
  });
});
