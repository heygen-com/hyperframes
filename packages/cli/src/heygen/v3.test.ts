import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CreateBackgroundRemovalRequest,
  CreateModelVideoRequest,
} from "../cloud/_gen/types.js";
import type { JobRoute } from "./v3.js";

vi.mock("../cloud/auth.js", () => ({
  resolveCloudAuthHeaders: async () => ({ "x-api-key": "k" }),
  refreshIfNeeded: async <T>(credential: T) => credential,
  resolveCloudBaseUrl: () => "https://api.test",
}));

const { idempotencyKey, ownVoices, runJob } = await import("./v3.js");

/** A job route through the generated client: the create and the status GET it polls. */
const X: JobRoute = {
  path: "/v3/models/videos",
  start: (c, body, key, signal) =>
    c.createModelVideo({ body: body as CreateModelVideoRequest, idempotencyKey: key, signal }),
  status: (c, id, signal) => c.getModelVideo({ video_id: id, signal }),
};

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
    const job = await runJob(X, { a: 1 }, "hf-key", { intervalMs: 1 });
    expect(job.output).toEqual({ json: { ok: 1 } });
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.test/v3/models/videos",
      "https://api.test/v3/models/videos/j1",
      "https://api.test/v3/models/videos/j1",
    ]);
    expect(new Headers(calls[0]!.init.headers).get("Idempotency-Key")).toBe("hf-key");
  });

  it("logs a job that is done at once one time, and a waited-for job at each end", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-v3-log-"));
    const rows = () =>
      readFileSync(join(projectDir, ".hyperframes/heygen-jobs.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((row) => JSON.parse(row).status);
    const log = { projectDir, what: "a line" };
    vi.stubGlobal("fetch", async () => reply(200, { data: { id: "j1", status: "completed" } }));
    await runJob(X, {}, "k1", { log });
    expect(rows()).toEqual(["completed"]);
    const answers = ["pending", "completed"].map((status) =>
      reply(200, { data: { id: "j2", status } }),
    );
    vi.stubGlobal("fetch", async () => answers.shift()!);
    await runJob(X, {}, "k2", { log, intervalMs: 1 });
    expect(rows()).toEqual(["completed", "pending", "completed"]);
  });

  describe("with a run credit limit", () => {
    const project = (limit: number) => {
      const projectDir = mkdtempSync(join(tmpdir(), "hf-v3-limit-"));
      mkdirSync(join(projectDir, ".hyperframes"));
      writeFileSync(
        join(projectDir, ".hyperframes/credit-limit.json"),
        JSON.stringify({ credits: limit }),
      );
      return { projectDir, what: "a line" };
    };
    const sent = () => {
      const calls: string[] = [];
      vi.stubGlobal("fetch", async (url: string) => {
        calls.push(url);
        return reply(200, { data: { id: "j", status: "completed" } });
      });
      return calls;
    };

    it("refuses a call over what is left, before sending, with no --max-credits given", async () => {
      const calls = sent();
      const log = project(100);
      await runJob(X, {}, "k1", { log, credits: 60 });
      await expect(runJob(X, {}, "k2", { log, credits: 60 })).rejects.toThrow(/leaves 40/);
      expect(calls).toHaveLength(1);
      await runJob(X, {}, "k3", { log, credits: 40 });
      expect(calls).toHaveLength(2);
    });

    it("counts what HeyGen charged in HyperFrames credits, else the estimate", async () => {
      const done = (charged: unknown) =>
        vi.stubGlobal("fetch", async () =>
          reply(200, { data: { id: "j", status: "completed", charged } }),
        );
      const log = project(100);
      done({ amount: 41, pool: "hyperframes_credits" });
      await runJob(X, {}, "k1", { log, credits: 60 });
      done(null);
      await runJob(X, {}, "k2", { log, credits: 59 });
      await expect(runJob(X, {}, "k3", { log, credits: 1 })).rejects.toThrow(/leaves 0/);
      const other = project(100);
      done({ amount: 2, pool: "api_credits" });
      await runJob(X, {}, "k1", { log: other, credits: 60 });
      await expect(runJob(X, {}, "k2", { log: other, credits: 59 })).rejects.toThrow(/leaves 40/);
    });

    it("holds a running vendor-priced call at its headroom until HeyGen says what it charged", async () => {
      const log = project(87);
      vi.stubGlobal("fetch", async () => {
        throw new Error("socket hang up");
      });
      await expect(runJob(X, {}, "k1", { log, credits: 40, vendorPriced: true })).rejects.toThrow();
      await expect(runJob(X, {}, "k2", { log, credits: 40, vendorPriced: true })).rejects.toThrow(
        /leaves 43/,
      );
      const polled = project(87);
      const answers = [reply(200, { data: { id: "j", status: "pending" } })];
      vi.stubGlobal("fetch", async () => {
        const answer = answers.shift();
        if (!answer) throw new Error("socket hang up");
        return answer;
      });
      await expect(
        runJob(X, {}, "k1", { log: polled, credits: 40, vendorPriced: true, intervalMs: 1 }),
      ).rejects.toThrow();
      await expect(
        runJob(X, {}, "k2", { log: polled, credits: 40, vendorPriced: true }),
      ).rejects.toThrow(/leaves 43/);
    });

    it("refuses a call that cannot be priced ahead", async () => {
      const calls = sent();
      await expect(runJob(X, {}, "k", { log: project(100) })).rejects.toThrow(/cannot be priced/);
      expect(calls).toHaveLength(0);
    });

    it.each([429, 422])(
      "keeps a lost job's reservation through a resume refused with %i",
      async (status) => {
        const log = project(100);
        vi.stubGlobal("fetch", async () => {
          throw new Error("socket hang up");
        });
        await expect(runJob(X, {}, "k1", { log, credits: 100 })).rejects.toThrow();
        vi.stubGlobal("fetch", async () => reply(status, { error: { code: "no", message: "no" } }));
        await expect(runJob(X, {}, "k1", { log, credits: 100 })).rejects.toThrow();
        const calls = sent();
        await expect(runJob(X, {}, "k2", { log, credits: 100 })).rejects.toThrow(/leaves 0/);
        expect(calls).toHaveLength(0);
      },
    );

    it("keeps the reservation of a fresh call refused with 429, which says nothing about the job", async () => {
      const log = project(100);
      vi.stubGlobal("fetch", async () => reply(429, { error: { code: "rate", message: "slow" } }));
      await expect(runJob(X, {}, "k1", { log, credits: 100 })).rejects.toThrow();
      await expect(runJob(X, {}, "k2", { log, credits: 100 })).rejects.toThrow(/leaves 0/);
    });

    it("lets the same job resume, and gives back a refused call's credits", async () => {
      const log = project(100);
      const calls = sent();
      await runJob(X, {}, "k1", { log, credits: 100 });
      await runJob(X, {}, "k1", { log, credits: 100 });
      expect(calls).toHaveLength(2);
      const fresh = project(100);
      vi.stubGlobal("fetch", async () => reply(422, { error: { code: "bad", message: "no" } }));
      await expect(runJob(X, {}, "k2", { log: fresh, credits: 100 })).rejects.toThrow();
      vi.stubGlobal("fetch", async () => reply(200, { data: { id: "j", status: "completed" } }));
      await runJob(X, {}, "k3", { log: fresh, credits: 100 });
    });
  });

  it("turns refusals into what to do next", async () => {
    vi.stubGlobal("fetch", async () =>
      reply(402, { error: { code: "insufficient_credit", message: "no" } }),
    );
    await expect(runJob(X, {}, "k")).rejects.toMatchObject({
      fix: expect.stringContaining("add-on credits"),
    });
    vi.stubGlobal("fetch", async () =>
      reply(402, { error: { code: "hf_subscription_required", message: "no plan" } }),
    );
    await expect(runJob(X, {}, "k")).rejects.toMatchObject({
      fix: "Subscribe: https://hyperframes.studio/pricing?from=cli&utm_source=cli&skill=media-use",
      url: "https://hyperframes.studio/pricing?from=cli&utm_source=cli&skill=media-use",
    });
    vi.stubGlobal("fetch", async () =>
      reply(402, { code: "hf_usage_exhausted", url: "https://pay.test/credits" }),
    );
    await expect(runJob(X, {}, "k")).rejects.toMatchObject({
      fix: "Buy add-on credits: https://pay.test/credits",
      url: "https://pay.test/credits",
    });
    vi.stubGlobal("fetch", async () => reply(401, { message: "bad" }));
    await expect(runJob(X, {}, "k")).rejects.toMatchObject({
      fix: "npx hyperframes auth login",
    });
    vi.stubGlobal("fetch", async () =>
      reply(200, { data: { id: "j", status: "failed", failure_code: "content_policy_violation" } }),
    );
    await expect(runJob(X, {}, "k")).rejects.toMatchObject({
      fix: expect.stringContaining("reword"),
    });
  });

  it.each(["hf_subscription_required", "hf_usage_exhausted"])(
    "gives no purchase link for %s when HeyGen withholds it (url: null)",
    async (code) => {
      vi.stubGlobal("fetch", async () => reply(402, { error: { code, url: null } }));
      const refused = await runJob(X, {}, "k").catch((err: unknown) => err);
      expect(refused).toMatchObject({
        fix: expect.stringContaining("can't be purchased right now"),
      });
      expect(refused).toMatchObject({ url: undefined });
      expect(JSON.stringify(refused)).not.toContain("https://");
      expect(String((refused as Error).message)).not.toContain("https://");
    },
  );

  it("names what an out-of-credits step needs, from the call's own price when HeyGen does not say", async () => {
    vi.stubGlobal("fetch", async () => reply(402, { error: { code: "hf_usage_exhausted" } }));
    await expect(runJob(X, {}, "k", { credits: 782 })).rejects.toMatchObject({
      message: expect.stringContaining("this step needs about 782 in total"),
    });
    await expect(runJob(X, {}, "k", { credits: 782 })).rejects.toMatchObject({
      message: expect.stringContaining("billing add-credits --needed 782"),
      fix: expect.stringContaining("needed_credits=782"),
    });
    vi.stubGlobal("fetch", async () =>
      reply(402, { error: { code: "hf_usage_exhausted", needed_credits: 180, balance: 30 } }),
    );
    await expect(runJob(X, {}, "k", { credits: 782 })).rejects.toMatchObject({
      message: expect.stringContaining("this step needs 180 in total, balance 30"),
    });
    vi.stubGlobal("fetch", async () => reply(402, { error: { code: "hf_usage_exhausted" } }));
    await expect(runJob(X, {}, "k")).rejects.toMatchObject({
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
      return runJob(X, {}, key, { intervalMs: 1 });
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

  it("puts the key in the body for a route that dedupes there, and moves it only past a failed job", async () => {
    const jobs = new Map<string, string>();
    const sent: string[] = [];
    let status = "completed";
    let lose = false;
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      if (init.method !== "POST") return reply(200, { data: { id: "j", status } });
      // like /v3/background-removals: the header is ignored, the body's request_id picks the job
      const id = String(JSON.parse(String(init.body)).request_id);
      sent.push(id);
      if (!jobs.has(id)) jobs.set(id, `job-${jobs.size}`);
      if (lose) return reply(408, { message: "timeout" });
      return reply(200, { data: { id: jobs.get(id), status } });
    });
    const cut: JobRoute = {
      path: "/v3/background-removals",
      start: (c, body, key, signal) =>
        c.createBackgroundRemoval({
          body: { ...(body as CreateBackgroundRemovalRequest), request_id: key },
          signal,
        }),
      status: (c, id, signal) => c.getBackgroundRemoval({ job_id: id, signal }),
    };
    const go = () => runJob(cut, { layers: ["foreground"] }, "hf-cut", { intervalMs: 1 });
    lose = true;
    await expect(go()).rejects.toThrow();
    lose = false;
    await go();
    expect(jobs.size).toBe(1);
    status = "failed";
    await expect(go()).rejects.toThrow();
    status = "completed";
    await go();
    expect(sent).toEqual(["hf-cut", "hf-cut", "hf-cut", "hf-cut-1"]);
    expect(jobs.size).toBe(2);
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
      await expect(runJob(X, {}, key)).rejects.toThrow();
      await runJob(X, {}, key);
      expect(keys).toEqual([key, key]);
    },
  );

  it("does not let one account's failure move another account's key", async () => {
    const keys: (string | null)[] = [];
    const run = (answers: Response[]) => {
      vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
        if (url.endsWith("/v1/pacific/account.get")) return reply(404, {}); // the refusal link's workspace read
        keys.push(new Headers(init.headers).get("Idempotency-Key"));
        return answers.shift()!;
      });
      return runJob(X, {}, "hf-shared");
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
        if (url.endsWith("/v1/pacific/account.get")) return reply(404, {}); // the refusal link's workspace read
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
      await runJob(X, {}, "hf-host");
      signIn("b");
      await expect(runJob(X, {}, "hf-host")).rejects.toThrow();
      signIn("a");
      await runJob(X, {}, "hf-host");
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
      await runJob(X, {}, "hf-switch");
      signIn("a");
      await expect(runJob(X, {}, "hf-switch", { intervalMs: 1 })).rejects.toThrow();
      await runJob(X, {}, "hf-switch");
      signIn("a");
      await runJob(X, {}, "hf-switch");
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
      await runJob(X, {}, "hf-window");
      expect(seen).toEqual(["Bearer a"]);
    });

    it("records nothing when the account cannot be told", async () => {
      const keys = server({ a: () => reply(503, {}) }, [
        reply(402, { error: { code: "hf_usage_exhausted" } }),
        done(),
      ]);
      signIn("a");
      await expect(runJob(X, {}, "hf-unknown")).rejects.toThrow();
      await runJob(X, {}, "hf-unknown");
      expect(keys).toEqual(["hf-unknown", "hf-unknown"]);
    });

    it("sends a job that failed for this account as a new one", async () => {
      const keys = server(accounts, [failed(), done()]);
      signIn("a");
      await expect(runJob(X, {}, "hf-own")).rejects.toThrow();
      await runJob(X, {}, "hf-own");
      expect(keys).toEqual(["hf-own", "hf-own-1"]);
    });

    it("keeps the key through a lost answer, then a new sign-in", async () => {
      const keys = server(accounts, [reply(401, { message: "expired" }), done()]);
      signIn("a");
      await expect(runJob(X, {}, "hf-resigned")).rejects.toThrow();
      await runJob(X, {}, "hf-resigned");
      expect(keys).toEqual(["hf-resigned", "hf-resigned"]);
    });
  });

  it("sends the request as JSON and polls the status route with a GET", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const answers = [
      reply(202, { data: { video_id: "v/1", status: "pending" } }),
      reply(200, { data: { id: "v/1", status: "completed" } }),
    ];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return answers.shift()!;
    });
    const job = await runJob(X, { prompt: "p" }, "hf-shape", { intervalMs: 1 });
    expect(job).toMatchObject({ id: "v/1", status: "completed" });
    const [post, get] = calls;
    expect(post!.init.method).toBe("POST");
    expect(JSON.parse(String(post!.init.body))).toEqual({ prompt: "p" });
    const headers = new Headers(post!.init.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-api-key")).toBe("payer");
    expect(get!.url).toBe("https://api.test/v3/models/videos/v%2F1");
    expect(get!.init.method).toBe("GET");
    expect(get!.init.body).toBeUndefined();
  });

  it("asks again for an answer it could not read or never got", async () => {
    vi.stubGlobal("fetch", async () => reply(503, { error: { code: "unavailable" } }));
    await expect(runJob(X, {}, "hf-503")).rejects.toMatchObject({
      message: "HeyGen 503 for /v3/models/videos with no readable answer",
      fix: "run the same command again: it resumes the same job",
    });
    vi.stubGlobal("fetch", async () => new Response("<html>", { status: 400 }));
    await expect(runJob(X, {}, "hf-html")).rejects.toThrow("HeyGen 400 for /v3/models/videos");
    vi.stubGlobal("fetch", async () => new Response("not json", { status: 200 }));
    await expect(runJob(X, {}, "hf-text")).rejects.toThrow("HeyGen 200 for /v3/models/videos");
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    await expect(runJob(X, {}, "hf-lost")).rejects.toMatchObject({
      message: "no answer from HeyGen for /v3/models/videos (fetch failed)",
    });
    const keys: (string | null)[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      keys.push(new Headers(init.headers).get("Idempotency-Key"));
      return reply(200, { data: { id: "j", status: "completed" } });
    });
    await runJob(X, {}, "hf-503");
    expect(keys).toEqual(["hf-503"]);
  });

  it("takes the answer of a route with no status as final", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      return reply(200, { data: { audio_url: "https://files.test/a.mp3", duration: 1 } });
    });
    const sync = { path: X.path, start: X.start };
    expect(await runJob(sync, {}, "hf-sync")).toMatchObject({
      id: "",
      status: "completed",
      audio_url: "https://files.test/a.mp3",
    });
    expect(calls).toHaveLength(1);
  });

  it("keys the same request the same way", () => {
    expect(idempotencyKey("/v3/x", ["a", Buffer.from("b")])).toBe(
      idempotencyKey("/v3/x", ["a", Buffer.from("b")]),
    );
    expect(idempotencyKey("/v3/x", ["a"])).not.toBe(idempotencyKey("/v3/y", ["a"]));
  });
});

describe("ownVoices", () => {
  it("lists the clones of the HyperFrames sign-in's workspace only, never another account's", async () => {
    const asked: { url: string; key: string | null }[] = [];
    const clonesByKey: Record<string, string> = {
      k: "film-account-clone",
      "heygen-cli-login": "other-account-clone",
    };
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const key = new Headers(init.headers).get("x-api-key");
      asked.push({ url, key });
      return reply(200, { data: [{ voice_id: "v1", name: clonesByKey[key ?? ""] }] });
    });
    expect(await ownVoices(5)).toEqual([
      { voice_id: "v1", name: "film-account-clone", language: undefined, gender: undefined },
    ]);
    expect(asked).toHaveLength(1);
    expect(new URL(asked[0]!.url).searchParams.get("type")).toBe("private");
    expect(asked[0]!.key).toBe("k");
  });

  it("refuses with the sign-in fix when the HyperFrames account cannot be reached, instead of listing anything", async () => {
    vi.stubGlobal("fetch", async () => reply(401, { message: "no" }));
    await expect(ownVoices(5)).rejects.toMatchObject({ fix: "npx hyperframes auth login" });
  });
});
