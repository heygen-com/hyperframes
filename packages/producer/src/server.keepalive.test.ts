import { Hono } from "hono";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Entry: createRenderHandlers().renderStream, with a render that hangs until the test ends it.
const renders = vi.hoisted(() => ({
  jobs: [] as Array<{ framesRendered: number; currentStage: string }>,
  finish: [] as Array<() => void>,
  sinks: [] as Array<(job: unknown, message: string) => Promise<void>>,
}));

vi.mock("./services/renderOrchestrator.js", () => ({
  RenderCancelledError: class extends Error {},
  createRenderJob: (config: Record<string, unknown>) => {
    const job = { config, progress: 0, currentStage: "Queued", framesRendered: 0, warnings: [] };
    renders.jobs.push(job);
    return job;
  },
  executeRenderJob: (
    _job: unknown,
    _dir: string,
    _out: string,
    sink: (job: unknown, message: string) => Promise<void>,
  ) => {
    renders.sinks.push(sink);
    return new Promise<void>((resolve) => renders.finish.push(resolve));
  },
}));

import { createRenderHandlers } from "./server.js";

beforeEach(() => {
  renders.jobs.length = 0;
  renders.finish.length = 0;
  renders.sinks.length = 0;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
});
afterEach(() => vi.useRealTimers());

async function settle(until: () => boolean): Promise<void> {
  for (let turn = 0; turn < 500 && !until(); turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  expect(until()).toBe(true);
}

function post(app: Hono): Promise<Response> {
  return Promise.resolve(
    app.request("/v1/render-stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ html: "<html><body></body></html>" }),
    }),
  );
}

function openStream(app: Hono): { events: Array<Record<string, unknown>> } {
  const events: Array<Record<string, unknown>> = [];
  void post(app).then(async (response) => {
    const decoder = new TextDecoder();
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      for (const line of decoder.decode(chunk).split("\n")) {
        if (line.startsWith("data:")) events.push(JSON.parse(line.slice(5)));
      }
    }
  });
  return { events };
}

it("keeps a queued and a running render-stream alive with live progress, and stops at the terminal event", async () => {
  const app = new Hono();
  app.post("/v1/render-stream", createRenderHandlers({ maxConcurrentRenders: 1 }).renderStream);
  openStream(app);
  await settle(() => renders.finish.length === 1);
  const queued = openStream(app);
  await settle(() => queued.events.some((event) => event.type === "queued"));

  renders.jobs[1]!.framesRendered = 7;
  await vi.advanceTimersByTimeAsync(95_000);
  await settle(() => queued.events.length >= 4);
  const pings = queued.events.filter((event) => event.type === "progress");
  expect(pings).toHaveLength(3);
  expect(pings[0]).toMatchObject({ stage: "Queued", framesRendered: 7 });
  expect(renders.finish).toHaveLength(1);

  renders.finish[0]!();
  await settle(() => renders.finish.length === 2);
  renders.finish[1]!();
  await settle(() => queued.events.some((event) => event.type === "complete"));
  await vi.advanceTimersByTimeAsync(95_000);
  await settle(() => true);
  expect(queued.events.at(-1)).toMatchObject({ type: "complete" });
});

it("frees the render slot when a render ends, even if its client stops reading", async () => {
  const app = new Hono();
  app.post("/v1/render-stream", createRenderHandlers({ maxConcurrentRenders: 1 }).renderStream);
  void post(app);
  await settle(() => renders.finish.length === 1);
  void renders.sinks[0]!(renders.jobs[0], "Rendering");
  renders.finish[0]!();
  openStream(app);
  await settle(() => renders.finish.length === 2);
});
