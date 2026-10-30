// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountRenderQueue, renderPosts, type MountedQueue } from "./renderQueueTestHarness";

vi.mock("../../telemetry/policy", () => ({ browserTelemetryAllowed: () => false }));
vi.mock("../../telemetry/config", () => ({ getAnonymousId: () => "unused" }));
vi.mock("../../telemetry/events", () => ({ trackStudioRenderStart: vi.fn() }));

const { useRenderQueue } = await import("./useRenderQueue");

let queue: MountedQueue | null = null;

afterEach(() => {
  queue?.unmount();
  queue = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

function stubFetch(renders: unknown[]) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") return json({ jobId: "seq-job", status: "rendering" });
    if (String(url).endsWith("/renders")) return json({ renders });
    return json({});
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal(
    "EventSource",
    class {
      close(): void {}
      addEventListener(): void {}
    },
  );
  return fetchMock;
}

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

describe("useRenderQueue directory renders", () => {
  it("maps a directory listing row to a directory job and leaves file rows untouched", async () => {
    stubFetch([
      { kind: "directory", id: "seq", filename: "seq", size: 10, frameCount: 90, createdAt: 2 },
      { id: "clip", filename: "clip.mp4", size: 5, createdAt: 1 },
    ]);
    queue = mountRenderQueue(useRenderQueue);
    await settle();

    const jobs = queue.api().jobs;
    expect(jobs.find((job) => job.id === "seq")).toMatchObject({
      kind: "directory",
      frameCount: 90,
      filename: "seq",
    });
    const file = jobs.find((job) => job.id === "clip");
    expect(file?.kind).toBeUndefined();
    expect(file?.filename).toBe("clip.mp4");
  });

  it("posts png-sequence and adds an extensionless directory job", async () => {
    const fetchMock = stubFetch([]);
    queue = mountRenderQueue(useRenderQueue);
    await settle();
    await act(async () => {
      await queue?.api().startRender({ format: "png-sequence" });
    });

    const [post] = renderPosts(fetchMock) as [[string, RequestInit]];
    expect(JSON.parse(String(post[1].body)).format).toBe("png-sequence");
    expect(queue.api().jobs.find((job) => job.id === "seq-job")).toMatchObject({
      filename: "seq-job",
      kind: "directory",
      status: "rendering",
    });
  });
});
