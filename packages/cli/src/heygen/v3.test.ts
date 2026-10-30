import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../cloud/auth.js", () => ({
  resolveCloudAuthHeaders: async () => ({ "x-api-key": "k" }),
  refreshIfNeeded: async <T>(credential: T) => credential,
  resolveCloudBaseUrl: () => "https://api.test",
}));

const { idempotencyKey, runJob } = await import("./v3.js");

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.stubEnv("HYPERFRAMES_CONFIG_DIR", mkdtempSync(join(tmpdir(), "hf-v3-test-")));
  vi.stubEnv("HEYGEN_API_KEY", "payer");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("runJob", () => {
  it("sends the key, polls until the job ends and returns it", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const answers = [
      reply(200, { data: { id: "j1", status: "pending" } }),
      reply(200, { data: { id: "j1", status: "processing" } }),
      reply(200, { data: { id: "j1", status: "completed", output: { json: { ok: 1 } } } }),
    ];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return answers.shift()!;
    });
    const job = await runJob("/v3/x", { a: 1 }, "hf-key", (id) => `/v3/x/${id}`, { intervalMs: 1 });
    expect(job.output).toEqual({ json: { ok: 1 } });
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.test/v3/x",
      "https://api.test/v3/x/j1",
      "https://api.test/v3/x/j1",
    ]);
    expect(new Headers(calls[0]!.init.headers).get("Idempotency-Key")).toBe("hf-key");
  });

  it("turns refusals into what to do next", async () => {
    vi.stubGlobal("fetch", async () =>
      reply(402, { error: { code: "insufficient_credit", message: "no" } }),
    );
    await expect(runJob("/v3/x", {}, "k", (id) => id)).rejects.toMatchObject({
      fix: expect.stringContaining("top up"),
    });
    vi.stubGlobal("fetch", async () =>
      reply(402, { error: { code: "hf_subscription_required", message: "no plan" } }),
    );
    await expect(runJob("/v3/x", {}, "k", (id) => id)).rejects.toMatchObject({
      fix: "Subscribe: https://hyperframes.studio/pricing?from=cli",
    });
    vi.stubGlobal("fetch", async () =>
      reply(402, { code: "hf_usage_exhausted", url: "https://pay.test/credits" }),
    );
    await expect(runJob("/v3/x", {}, "k", (id) => id)).rejects.toMatchObject({
      fix: "Add credits: https://pay.test/credits",
    });
    vi.stubGlobal("fetch", async () => reply(401, { message: "bad" }));
    await expect(runJob("/v3/x", {}, "k", (id) => id)).rejects.toMatchObject({
      fix: "npx hyperframes auth login",
    });
    vi.stubGlobal("fetch", async () =>
      reply(200, { data: { id: "j", status: "failed", failure_code: "content_policy_violation" } }),
    );
    await expect(runJob("/v3/x", {}, "k", (id) => id)).rejects.toMatchObject({
      fix: expect.stringContaining("reword"),
    });
  });

  it("names what an out-of-credits step needs, from the call's own price when HeyGen does not say", async () => {
    vi.stubGlobal("fetch", async () => reply(402, { error: { code: "hf_usage_exhausted" } }));
    await expect(runJob("/v3/x", {}, "k", (id) => id, { credits: 782 })).rejects.toMatchObject({
      message: expect.stringContaining("this step needs about 782"),
    });
    await expect(runJob("/v3/x", {}, "k", (id) => id, { credits: 782 })).rejects.toMatchObject({
      message: expect.stringContaining("billing top-up --needed 782"),
      fix: expect.stringContaining("needed_credits=782"),
    });
    vi.stubGlobal("fetch", async () =>
      reply(402, { error: { code: "hf_usage_exhausted", needed_credits: 180, balance: 30 } }),
    );
    await expect(runJob("/v3/x", {}, "k", (id) => id, { credits: 782 })).rejects.toMatchObject({
      message: expect.stringContaining("this step needs 180, balance 30"),
    });
    vi.stubGlobal("fetch", async () => reply(402, { error: { code: "hf_usage_exhausted" } }));
    await expect(runJob("/v3/x", {}, "k", (id) => id)).rejects.toMatchObject({
      message: expect.stringContaining("this step needs more"),
    });
  });

  it("sends a failed or refused job again as a new one, and picks a finished one up", async () => {
    const keys: (string | null)[] = [];
    const run = (key: string, answers: Response[]) => {
      vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
        if (init.method === "POST") keys.push(new Headers(init.headers).get("Idempotency-Key"));
        return answers.shift()!;
      });
      return runJob("/v3/x", {}, key, (id) => `/v3/x/${id}`, { intervalMs: 1 });
    };
    const failed = () => [
      reply(200, { data: { id: "j", status: "pending" } }),
      reply(200, { data: { id: "j", status: "failed", failure_code: "generation_failed" } }),
    ];
    const done = () => [reply(200, { data: { id: "j", status: "completed" } })];

    await expect(run("hf-fails", failed())).rejects.toMatchObject({
      fix: "fix the request it names, then run again",
    });
    await expect(run("hf-fails", failed())).rejects.toThrow("generation_failed");
    await run("hf-fails", done());
    await run("hf-fails", done());
    expect(keys).toEqual(["hf-fails", "hf-fails-1", "hf-fails-2", "hf-fails-2"]);

    keys.length = 0;
    await run("hf-works", done());
    await run("hf-works", done());
    expect(keys).toEqual(["hf-works", "hf-works"]);

    keys.length = 0;
    await expect(
      run("hf-broke", [reply(402, { error: { code: "hf_usage_exhausted" } })]),
    ).rejects.toThrow("out of HyperFrames credits");
    await run("hf-broke", done());
    expect(keys).toEqual(["hf-broke", "hf-broke-1"]);
  });

  it.each([401, 403, 408, 409, 425, 429])(
    "keeps the key after a %i, which says nothing about the job",
    async (status) => {
      const key = `hf-lost-${status}`;
      const keys: (string | null)[] = [];
      const answers = [
        reply(status, { message: "no" }),
        reply(200, { data: { id: "j", status: "completed" } }),
      ];
      vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
        keys.push(new Headers(init.headers).get("Idempotency-Key"));
        return answers.shift()!;
      });
      await expect(runJob("/v3/x", {}, key, (id) => id)).rejects.toThrow();
      await runJob("/v3/x", {}, key, (id) => id);
      expect(keys).toEqual([key, key]);
    },
  );

  it("does not let one account's failure move another account's key", async () => {
    const keys: (string | null)[] = [];
    const run = (answers: Response[]) => {
      vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
        keys.push(new Headers(init.headers).get("Idempotency-Key"));
        return answers.shift()!;
      });
      return runJob("/v3/x", {}, "hf-shared", (id) => id);
    };
    vi.stubEnv("HEYGEN_API_KEY", "payer-a");
    await expect(run([reply(402, { code: "hf_usage_exhausted" })])).rejects.toThrow();
    vi.stubEnv("HEYGEN_API_KEY", "payer-b");
    await run([reply(200, { data: { id: "j", status: "completed" } })]);
    expect(keys).toEqual(["hf-shared", "hf-shared"]);
  });

  describe("with a host's sign-in token", () => {
    const signIn = (token: string) => {
      vi.stubEnv("HEYGEN_API_KEY", "");
      vi.stubEnv("HEYGEN_ACCESS_TOKEN", token);
    };
    const done = () => reply(200, { data: { id: "j", status: "completed" } });
    const failed = () =>
      reply(200, { data: { id: "j", status: "failed", failure_code: "generation_failed" } });
    /** Answers `/v3/users/me` with `accounts`, and each job call with the next of `answers`. */
    const server = (
      accounts: Record<string, Response | (() => Response)>,
      answers: (Response | (() => Response))[],
    ) => {
      const keys: (string | null)[] = [];
      vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
        if (!url.endsWith("/v3/users/me")) {
          if (init.method === "POST") keys.push(new Headers(init.headers).get("Idempotency-Key"));
          const answer = answers.shift()!;
          return typeof answer === "function" ? answer() : answer;
        }
        const token = new Headers(init.headers).get("authorization")?.replace("Bearer ", "");
        const account = accounts[token!]!;
        return typeof account === "function" ? account() : account.clone();
      });
      return keys;
    };
    const accounts = {
      a: reply(200, { data: { username: "a", email: "same@test" } }),
      b: reply(200, { data: { username: "b", email: "same@test" } }),
    };

    it.each([
      ["no local user", null],
      ["someone else's local user", { user: { email: "stale@test" } }],
    ])("gives each account its own failures, with %s", async (_name, stored) => {
      if (stored)
        writeFileSync(
          join(process.env["HYPERFRAMES_CONFIG_DIR"]!, "credentials"),
          JSON.stringify(stored),
        );
      const keys = server(accounts, [
        done(),
        reply(402, { error: { code: "hf_usage_exhausted" } }),
        done(),
      ]);
      signIn("a");
      await runJob("/v3/x", {}, "hf-host", (id) => id);
      signIn("b");
      await expect(runJob("/v3/x", {}, "hf-host", (id) => id)).rejects.toThrow();
      signIn("a");
      await runJob("/v3/x", {}, "hf-host", (id) => id);
      expect(keys).toEqual(["hf-host", "hf-host", "hf-host"]);
    });

    it("holds a failure to the account that sent the job, whoever signs in during it", async () => {
      const keys = server(accounts, [
        done(),
        reply(200, { data: { id: "j", status: "pending" } }),
        () => {
          signIn("b");
          return failed();
        },
        done(),
        done(),
      ]);
      signIn("b");
      await runJob("/v3/x", {}, "hf-switch", (id) => id);
      signIn("a");
      await expect(
        runJob("/v3/x", {}, "hf-switch", (id) => id, { intervalMs: 1 }),
      ).rejects.toThrow();
      await runJob("/v3/x", {}, "hf-switch", (id) => id);
      signIn("a");
      await runJob("/v3/x", {}, "hf-switch", (id) => id);
      expect(keys).toEqual(["hf-switch", "hf-switch", "hf-switch", "hf-switch-1"]);
    });

    it("sends the job with the credential it looked up", async () => {
      const seen: (string | null)[] = [];
      const me = accounts.a;
      vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
        if (url.endsWith("/v3/users/me")) {
          signIn("b");
          return me.clone();
        }
        seen.push(new Headers(init.headers).get("authorization"));
        return done();
      });
      signIn("a");
      await runJob("/v3/x", {}, "hf-window", (id) => id);
      expect(seen).toEqual(["Bearer a"]);
    });

    it("records nothing when the account cannot be told", async () => {
      const keys = server({ a: () => reply(503, {}) }, [
        reply(402, { error: { code: "hf_usage_exhausted" } }),
        done(),
      ]);
      signIn("a");
      await expect(runJob("/v3/x", {}, "hf-unknown", (id) => id)).rejects.toThrow();
      await runJob("/v3/x", {}, "hf-unknown", (id) => id);
      expect(keys).toEqual(["hf-unknown", "hf-unknown"]);
    });

    it("sends a job that failed for this account as a new one", async () => {
      const keys = server(accounts, [failed(), done()]);
      signIn("a");
      await expect(runJob("/v3/x", {}, "hf-own", (id) => id)).rejects.toThrow();
      await runJob("/v3/x", {}, "hf-own", (id) => id);
      expect(keys).toEqual(["hf-own", "hf-own-1"]);
    });

    it("keeps the key through a lost answer, then a new sign-in", async () => {
      const keys = server(accounts, [reply(401, { message: "expired" }), done()]);
      signIn("a");
      await expect(runJob("/v3/x", {}, "hf-resigned", (id) => id)).rejects.toThrow();
      await runJob("/v3/x", {}, "hf-resigned", (id) => id);
      expect(keys).toEqual(["hf-resigned", "hf-resigned"]);
    });
  });

  it("keys the same request the same way", () => {
    expect(idempotencyKey("/v3/x", ["a", Buffer.from("b")])).toBe(
      idempotencyKey("/v3/x", ["a", Buffer.from("b")]),
    );
    expect(idempotencyKey("/v3/x", ["a"])).not.toBe(idempotencyKey("/v3/y", ["a"]));
  });
});
