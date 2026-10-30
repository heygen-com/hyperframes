import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../cloud/auth.js", () => ({
  resolveCloudAuthHeaders: async () => ({ "x-api-key": "k" }),
  resolveCloudBaseUrl: () => "https://api.test",
}));

const { idempotencyKey, runJob } = await import("./v3.js");
const { partsOf, slowBy } = await import("../commands/analyze.js");
const { mergeDrafts, toFilmTime } = await import("./reverseDraft.js");

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

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

  it("keys the same request the same way", () => {
    expect(idempotencyKey("/v3/x", ["a", Buffer.from("b")])).toBe(
      idempotencyKey("/v3/x", ["a", Buffer.from("b")]),
    );
    expect(idempotencyKey("/v3/x", ["a"])).not.toBe(idempotencyKey("/v3/y", ["a"]));
  });
});

describe("analyze helpers", () => {
  it("splits at cuts into parts of at most 30 s", () => {
    expect(partsOf(20, [5])).toEqual([[0, 20]]);
    expect(partsOf(70, [12, 27, 41, 58])).toEqual([
      [0, 27],
      [27, 41],
      [41, 70],
    ]);
    expect(partsOf(65, [])).toEqual([
      [0, 30],
      [30, 60],
      [60, 65],
    ]);
  });

  it("slows a part so 2 fps sees the asked rate, within 90 s", () => {
    expect(slowBy(6, 10)).toBe(3);
    expect(slowBy(6, 60)).toBe(1.5);
    expect(slowBy(1, 10)).toBe(1);
  });

  it("maps answer times back to the film and joins parts", () => {
    const a = toFilmTime(
      { segments: [{ id: "S01", start: 0, end: 30, actions: [{ start: 3, end: 6, what: "x" }] }] },
      3,
      0,
    );
    const b = toFilmTime(
      {
        segments: [{ id: "S01", start: 0, end: 15 }],
        questions: [{ segment: "S01", start: 3, question: "q" }],
      },
      3,
      10,
    );
    const draft = mergeDrafts([a, b]);
    expect(draft.segments).toEqual([
      { id: "S01", start: 0, end: 10, actions: [{ start: 1, end: 2, what: "x" }] },
      { id: "S02", start: 10, end: 15 },
    ]);
    expect(draft.questions).toEqual([{ segment: "S02", start: 11, question: "q" }]);
  });
});
