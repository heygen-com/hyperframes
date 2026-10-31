// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestStudioFeedback } from "../feedback/feedbackTrigger";
import { mountRenderQueue, stubRenderFetch, type MountedQueue } from "./renderQueueTestHarness";

vi.mock("../../telemetry/policy", () => ({ browserTelemetryAllowed: () => false }));
vi.mock("../../telemetry/config", () => ({ getAnonymousId: () => "unused" }));
vi.mock("../../telemetry/events", () => ({ trackStudioRenderStart: vi.fn() }));
vi.mock("../feedback/feedbackTrigger", () => ({ requestStudioFeedback: vi.fn() }));

const { useRenderQueue } = await import("./useRenderQueue");

const streams: ControlledEventSource[] = [];
let queue: MountedQueue | null = null;

class ControlledEventSource {
  private listeners = new Map<string, (event: MessageEvent<string>) => void>();
  close = vi.fn();
  onerror: (() => void) | null = null;

  constructor() {
    streams.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    this.listeners.set(type, listener);
  }

  progress(update: unknown): void {
    this.listeners.get("progress")?.(
      new MessageEvent("progress", { data: JSON.stringify(update) }),
    );
  }
}

function mountedQueue(): MountedQueue {
  if (!queue) throw new Error("render queue has not been mounted");
  return queue;
}

function latestStream(): ControlledEventSource {
  const stream = streams.at(-1);
  if (!stream) throw new Error("render has not opened its progress stream");
  return stream;
}

function stubQueue(history: unknown[] = []): void {
  const fetchMock = stubRenderFetch();
  let nextJob = 0;
  fetchMock.mockImplementation(async (input: unknown, init?: RequestInit) => {
    const path = String(input);
    const body = path.endsWith("/ffmpeg")
      ? { ok: true }
      : path.endsWith("/cancel")
        ? { status: "cancelled" }
        : init?.method === "POST"
          ? { jobId: `j${++nextJob}` }
          : { renders: history };
    return new Response(JSON.stringify(body), {
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("EventSource", ControlledEventSource);
  queue = mountRenderQueue(useRenderQueue);
}

beforeEach(() => {
  localStorage.clear();
  streams.length = 0;
  vi.clearAllMocks();
});

afterEach(() => {
  queue?.unmount();
  queue = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("render session feedback", () => {
  it.each(["complete", "failed"])(
    "reports a session render's %s outcome once with its settings and progress",
    async (status) => {
      const now = vi.spyOn(Date, "now").mockReturnValue(1000);
      stubQueue();
      await act(async () => {
        await mountedQueue()
          .api()
          .startRender({
            format: "webm",
            quality: "high",
            fps: 60,
            resolution: "720p",
            composition: "parts/chosen.html",
            variables: { title: "example" },
          });
      });
      const stream = latestStream();
      await act(async () => {
        stream.progress({ status: "rendering", progress: 25, stage: "capture" });
      });
      expect(requestStudioFeedback).not.toHaveBeenCalled();

      now.mockReturnValue(1500);
      const error = status === "failed" ? "encoder exited with code 1" : undefined;
      const progress = status === "complete" ? 100 : 42;
      await act(async () => {
        stream.progress({ status, progress, stage: "encode", error });
      });
      expect(requestStudioFeedback).toHaveBeenCalledExactlyOnceWith({
        reason: status === "complete" ? "render_complete" : "render_failed",
        renderId: "j1",
        detail: error,
        context: {
          render_format: "webm",
          render_quality: "high",
          render_fps: 60,
          render_resolution: "720p",
          render_composition: "parts/chosen.html",
          render_has_variables: true,
          render_progress: progress,
          render_duration_ms: 500,
          render_stage: "encode",
          render_error: error,
          renders_this_session: 1,
        },
      });
      expect(mountedQueue().api().jobs[0]?.status).toBe(status);
      expect(stream.close).toHaveBeenCalledOnce();

      now.mockReturnValue(2000);
      await act(async () => {
        stream.progress({ status, progress, stage: "later terminal update", error });
      });
      expect(requestStudioFeedback).toHaveBeenCalledTimes(1);
    },
  );

  it("does not prompt for loaded history or a session render that is cancelled", async () => {
    stubQueue(
      ["complete", "failed"].map((status) => ({
        id: `history-${status}`,
        status,
        filename: `${status}.mp4`,
        createdAt: 1,
        size: 100,
        durationMs: 20,
      })),
    );
    await act(async () => {
      await mountedQueue().api().reloadRenders();
    });
    expect(
      mountedQueue()
        .api()
        .jobs.map((job) => job.status),
    ).toEqual(["complete", "failed"]);
    expect(requestStudioFeedback).not.toHaveBeenCalled();

    await act(async () => {
      await mountedQueue().api().startRender({});
    });
    const stream = latestStream();
    await act(async () => {
      await mountedQueue().api().cancelRender("j1");
    });
    expect(mountedQueue().api().jobs.at(-1)).toMatchObject({ id: "j1", status: "cancelled" });
    expect(stream.close).toHaveBeenCalledOnce();
    expect(requestStudioFeedback).not.toHaveBeenCalled();
  });
});
