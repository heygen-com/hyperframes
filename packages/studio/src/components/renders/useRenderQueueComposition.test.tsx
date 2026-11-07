// @vitest-environment happy-dom

// The render POST is the only place Studio says WHICH file to render. When it
// says nothing the server falls back to index.html, so a caller that forgets
// the field does not fail — it silently exports the wrong video (#3549). The
// default therefore lives in startRender, which every control routes through.

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mountRenderQueue,
  renderPosts,
  startRenderAndReadBody,
  stubRenderFetch,
  type MountedQueue,
} from "./renderQueueTestHarness";
import { getRenderSettings, updatePersistedRenderSettings } from "./renderSettings";

vi.mock("../../telemetry/policy", () => ({ browserTelemetryAllowed: () => false }));
vi.mock("../../telemetry/config", () => ({ getAnonymousId: () => "unused" }));
vi.mock("../../telemetry/events", () => ({ trackStudioRenderStart: vi.fn() }));
vi.mock("../feedback/feedbackTrigger", () => ({ requestStudioFeedback: vi.fn() }));

const { useRenderQueue } = await import("./useRenderQueue");

let queue: MountedQueue | null = null;
beforeEach(() => localStorage.clear());

/** Body of the render POST, started with `opts` while `activeCompPath` is open. */
async function renderBody(
  activeCompPath: string | null,
  opts?: Parameters<ReturnType<typeof useRenderQueue>["startRender"]>[0],
): Promise<Record<string, unknown>> {
  const started = await startRenderAndReadBody(useRenderQueue, { activeCompPath, opts });
  queue = started.queue;
  return started.body;
}

afterEach(() => {
  queue?.unmount();
  queue = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("render target composition", () => {
  it("renders the composition the user has selected when the caller names none", async () => {
    // The header's Export button: no options at all.
    const body = await renderBody("parts/part-1.html", undefined);
    expect(body["composition"]).toBe("parts/part-1.html");
  });

  it("keeps the caller's composition when one is named", async () => {
    // The sidebar's per-composition Render button renders a card the user is
    // not looking at, so its argument must win over the active composition.
    const body = await renderBody("parts/part-1.html", { composition: "parts/part-4.html" });
    expect(body["composition"]).toBe("parts/part-4.html");
  });

  it("omits the composition when nothing is selected", async () => {
    // Master view. The server's index.html fallback is the right answer here.
    const body = await renderBody(null, { format: "mp4" });
    expect(body["composition"]).toBeUndefined();
  });
});

describe("GPU encoding", () => {
  it("asks the server for GPU encoding when the export asks for it", async () => {
    const body = await renderBody(null, { format: "mp4", gpu: true });
    expect(body["gpu"]).toBe(true);
  });

  it("leaves GPU encoding off by default", async () => {
    const body = await renderBody(null, { format: "mp4" });
    expect(body["gpu"]).toBeUndefined();
  });
});

describe("settings at each export entry", () => {
  it.each([undefined, { composition: "parts/card.html" }])(
    "uses defaults for header/card-shaped options %s without changing saved settings",
    async (opts) => {
      const saved = updatePersistedRenderSettings({
        format: "webm",
        quality: "high",
        fps: 60,
        gpu: true,
        rateControl: { mode: "crf", value: 63 },
        videoFrameFormat: "png",
        hdrMode: "force-sdr",
      });
      const body = await renderBody("parts/active.html", opts);
      expect(body).toEqual({
        format: "mp4",
        quality: "standard",
        fps: 30,
        composition: opts?.composition ?? "parts/active.html",
        telemetryOptOut: true,
      });
      expect(getRenderSettings()).toEqual(saved);
    },
  );

  it("uses saved settings when the render panel passes its form explicitly", async () => {
    const saved = updatePersistedRenderSettings({
      format: "webm",
      quality: "high",
      fps: 60,
      gpu: true,
      rateControl: { mode: "crf", value: 63 },
      videoFrameFormat: "png",
      hdrMode: "force-sdr",
    });
    expect(await renderBody("parts/active.html", saved)).toEqual({
      format: "webm",
      quality: "high",
      fps: 60,
      gpu: true,
      crf: 63,
      videoFrameFormat: "png",
      hdrMode: "force-sdr",
      composition: "parts/active.html",
      telemetryOptOut: true,
    });
    expect(getRenderSettings()).toEqual(saved);
  });

  it("lets explicit Auto/false clear overrides and preserves per-export fps", async () => {
    updatePersistedRenderSettings({
      gpu: true,
      rateControl: { mode: "crf", value: 18 },
      videoFrameFormat: "png",
      hdrMode: "force-hdr",
    });
    expect(
      await renderBody(null, {
        gpu: false,
        fps: 12,
        rateControl: { mode: "auto" },
        videoFrameFormat: "auto",
        hdrMode: "auto",
      }),
    ).toEqual({
      format: "mp4",
      quality: "standard",
      fps: 12,
      telemetryOptOut: true,
    });
  });

  it("omits MOV rate fields while preserving source-frame/HDR requests", async () => {
    const saved = updatePersistedRenderSettings({
      rateControl: { mode: "bitrate", value: "500k" },
      videoFrameFormat: "jpg",
      hdrMode: "force-hdr",
    });
    expect(await renderBody(null, { ...saved, format: "mov" })).toEqual({
      format: "mov",
      quality: "standard",
      fps: 30,
      videoFrameFormat: "jpg",
      hdrMode: "force-hdr",
      telemetryOptOut: true,
    });
  });

  it("refuses invalid explicit CRF before a POST", async () => {
    const fetchMock = stubRenderFetch();
    queue = mountRenderQueue(useRenderQueue);
    await act(async () => {
      await queue?.api().startRender({ rateControl: { mode: "crf", value: 52 } });
    });
    expect(renderPosts(fetchMock)).toHaveLength(0);
    expect(queue.api().jobs[0]).toMatchObject({
      status: "failed",
      filename: "Export blocked",
      error: expect.stringContaining("51"),
    });
  });
});

describe("render submission concurrency", () => {
  it("coalesces clicks while the POST is pending without blocking a later explicit render", async () => {
    const fetchMock = stubRenderFetch();
    let finish = () => {};
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let posted = 0;
    fetchMock.mockImplementation(async (...args: unknown[]) => {
      if ((args[1] as RequestInit | undefined)?.method !== "POST")
        return new Response(JSON.stringify({ renders: [] }));
      const jobId = `j${++posted}`;
      await pending;
      return new Response(JSON.stringify({ jobId }));
    });
    queue = mountRenderQueue(useRenderQueue);
    await act(async () => {
      const first = queue!.api().startRender({ composition: "parts/first.html" });
      const repeated = queue!.api().startRender({ composition: "parts/first.html" });
      finish();
      await Promise.all([first, repeated]);
    });
    expect(renderPosts(fetchMock)).toHaveLength(1);
    expect(queue.api().jobs).toHaveLength(1);
    await act(async () => {
      await queue!.api().startRender({ composition: "parts/second.html" });
    });
    expect(renderPosts(fetchMock)).toHaveLength(2);
    expect(queue.api().jobs.map((job) => job.id)).toEqual(["j1", "j2"]);
  });

  it.each(["transport", "server", "json"])("allows retry after %s failure", async (failure) => {
    const fetchMock = stubRenderFetch();
    let posted = 0;
    fetchMock.mockImplementation(async (...args: unknown[]) => {
      if ((args[1] as RequestInit | undefined)?.method !== "POST")
        return new Response(JSON.stringify({ renders: [] }));
      if (++posted === 1) {
        if (failure === "transport") throw new Error("offline");
        if (failure === "server") return new Response("rejected", { status: 503 });
        return new Response("invalid JSON");
      }
      return new Response(JSON.stringify({ jobId: "retry" }));
    });
    queue = mountRenderQueue(useRenderQueue);
    await act(async () => {
      await queue!
        .api()
        .startRender({})
        .catch(() => {});
      await queue!.api().startRender({});
    });
    expect(renderPosts(fetchMock)).toHaveLength(2);
    expect(queue.api().jobs.at(-1)).toMatchObject({ id: "retry", status: "rendering" });
  });
});

describe("GIF export transport", () => {
  it.each([0, 3, 65535])("forwards loop count %i and creates a GIF queue item", async (gifLoop) => {
    const body = await renderBody(null, { format: "gif", gifLoop });
    expect(body).toMatchObject({ format: "gif", gifLoop });
    expect(queue?.api().jobs).toEqual([expect.objectContaining({ filename: "j1.gif" })]);
  });

  it("omits GIF options for video exports", async () => {
    const body = await renderBody(null, { format: "mp4", gifLoop: 3 });
    expect(body).not.toHaveProperty("gifLoop");
  });
});
