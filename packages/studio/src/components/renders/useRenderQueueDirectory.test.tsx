// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountRenderQueue, renderPosts, type MountedQueue } from "./renderQueueTestHarness";
import { RenderQueue } from "./RenderQueue";

vi.mock("../../telemetry/policy", () => ({ browserTelemetryAllowed: () => false }));
vi.mock("../../telemetry/config", () => ({ getAnonymousId: () => "unused" }));
vi.mock("../../telemetry/events", () => ({ trackStudioRenderStart: vi.fn() }));

const { useRenderQueue } = await import("./useRenderQueue");

let queue: MountedQueue | null = null;

afterEach(() => {
  queue?.unmount();
  queue = null;
  document.body.innerHTML = "";
  window.localStorage.clear();
  vi.restoreAllMocks();
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

function progressSource() {
  const listeners: Array<(event: { data: string }) => void> = [];
  vi.stubGlobal(
    "EventSource",
    class {
      close() {}
      addEventListener(_name: string, listener: (event: { data: string }) => void) {
        listeners.push(listener);
      }
    },
  );
  return (data: unknown, index = 0) =>
    act(async () => {
      listeners[index]?.({ data: JSON.stringify(data) });
    });
}

function pendingResponse() {
  let deliver!: (response: Response) => void;
  const promise = new Promise<Response>((resolve) => {
    deliver = resolve;
  });
  return { promise, deliver };
}

const fileFamilies = [
  { id: "alias-mp4", filename: "intro.mp4", createdAt: 1 },
  { id: "alias-mov", filename: "intro.mov", createdAt: 2 },
  { id: "alias-png", filename: "intro", kind: "directory", createdAt: 3 },
  { id: "intro", filename: "introduction.mp4", createdAt: 4 },
];
const survivors = ["alias-png", "intro"];

describe("deleted render families", () => {
  it.each(["stale", "empty"] as const)(
    "removes distinct file aliases, including unseen siblings from %s history",
    async (history) => {
      const fetchMock = stubFetch(fileFamilies);
      queue = mountRenderQueue(useRenderQueue);
      await settle();
      const delayed = pendingResponse();
      fetchMock.mockImplementation((url: string, init?: RequestInit) =>
        init?.method === "DELETE"
          ? Promise.resolve(json({ deleted: true }))
          : String(url).endsWith("/renders")
            ? delayed.promise
            : Promise.resolve(json({})),
      );
      let loading!: Promise<void>;
      act(() => {
        loading = queue!.api().reloadRenders();
      });
      await act(async () => {
        await queue?.api().deleteRender("alias-mp4");
      });
      expect.soft(queue.api().jobs.map((job) => job.id)).toEqual(survivors);
      await act(async () => {
        delayed.deliver(
          json({
            renders:
              history === "empty"
                ? []
                : [
                    ...fileFamilies,
                    { id: "unseen-gif", filename: "intro.gif", createdAt: 5 },
                    { id: "unseen-webm", filename: "intro.webm", createdAt: 6 },
                  ],
          }),
        );
        await loading;
      });
      expect(queue.api().jobs.map((job) => job.id)).toEqual(survivors);
      await act(async () => {
        await queue?.api().deleteRender("alias-mp4");
      });
      expect(queue.api().jobs.map((job) => job.id)).toEqual(survivors);
    },
  );

  it("suppresses a sibling's late POST and progress after deletion", async () => {
    const fetchMock = stubFetch(fileFamilies.filter((row) => row.id !== "alias-mov"));
    const emit = progressSource();
    queue = mountRenderQueue(useRenderQueue);
    await settle();
    const post = pendingResponse();
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === "POST" ? post.promise : Promise.resolve(json({ deleted: true })),
    );
    let starting!: Promise<unknown>;
    act(() => {
      starting = queue!.api().startRender({ format: "mov" });
    });
    await act(async () => {
      await queue?.api().deleteRender("alias-mp4");
    });
    await act(async () => {
      post.deliver(json({ jobId: "late-sibling", filename: "intro.mov" }));
      await starting;
    });
    await emit({ status: "complete", progress: 100 });
    expect(queue.api().jobs.map((job) => job.id)).toEqual(survivors);
  });

  it("captures the clicked family and preserves unrelated renders started while DELETE is pending", async () => {
    const fetchMock = stubFetch(fileFamilies);
    queue = mountRenderQueue(useRenderQueue);
    await settle();
    const deletion = pendingResponse();
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === "DELETE"
        ? deletion.promise
        : Promise.resolve(json({ jobId: "new-live", filename: "intro-new.mp4" })),
    );
    let deleting!: Promise<void>;
    act(() => {
      deleting = queue!.api().deleteRender("alias-mp4");
    });
    expect(queue.api().jobs).toHaveLength(4);
    await act(async () => {
      await queue?.api().startRender({ format: "mp4" });
    });
    await act(async () => {
      deletion.deliver(json({ deleted: true }));
      await deleting;
    });
    expect(queue.api().jobs.map((job) => job.id)).toEqual([...survivors, "new-live"]);
    expect(queue.api().jobs.find((job) => job.id === "new-live")).toMatchObject({
      status: "rendering",
      progress: 0,
    });
  });

  it.each(["http", "network"])(
    "does not tombstone a family on a failed %s DELETE",
    async (failure) => {
      const fetchMock = stubFetch(fileFamilies);
      queue = mountRenderQueue(useRenderQueue);
      await settle();
      fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
        if (init?.method === "DELETE") {
          if (failure === "network") throw new Error("offline");
          return new Response("failed", { status: 500 });
        }
        return json({
          renders: [...fileFamilies, { id: "later", filename: "intro.webm", createdAt: 5 }],
        });
      });
      await act(async () => {
        await queue?.api().deleteRender("alias-mp4");
      });
      expect(queue.api().jobs).toHaveLength(4);
      expect(queue.api().actionError).not.toBeNull();
      await act(async () => {
        await queue?.api().reloadRenders();
      });
      expect(queue.api().jobs).toHaveLength(5);
    },
  );

  it.each(["completed", "pending"])("scopes %s family deletion to the project", async (state) => {
    const fetchMock = stubFetch(fileFamilies);
    queue = mountRenderQueue(useRenderQueue);
    await settle();
    const deletion = pendingResponse();
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === "DELETE"
        ? deletion.promise
        : Promise.resolve(json({ renders: fileFamilies })),
    );
    let deleting!: Promise<void>;
    act(() => {
      deleting = queue!.api().deleteRender("alias-mp4");
    });
    if (state === "completed")
      await act(async () => {
        deletion.deliver(json({}));
        await deleting;
      });
    queue.setProject("other");
    await settle();
    if (state === "pending")
      await act(async () => {
        deletion.deliver(json({}));
        await deleting;
      });
    expect(queue.api().jobs).toHaveLength(4);
    queue.setProject("demo");
    await settle();
    expect(queue.api().jobs).toHaveLength(4);
  });

  it("handles synthetic failures by ID without grouping their identical labels", async () => {
    const fetchMock = stubFetch([]);
    queue = mountRenderQueue(useRenderQueue);
    await settle();
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "POST" ? new Response("failed", { status: 500 }) : json({}),
    );
    await act(async () => {
      await queue?.api().startRender({});
      await queue?.api().startRender({});
    });
    expect(queue.api().jobs).toHaveLength(2);
    const [first, second] = queue.api().jobs;
    await act(async () => {
      await queue?.api().deleteRender(first!.id);
    });
    expect(queue.api().jobs.map((job) => job.id)).toEqual([second!.id]);
  });
});

describe("useRenderQueue directory renders", () => {
  it("retries failed history through the actual Retry button without treating its click as a row ID", async () => {
    stubFetch([]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("offline", { status: 503 })),
    );
    queue = mountRenderQueue(useRenderQueue, "demo", null, (api) => (
      <RenderQueue
        jobs={api.jobs}
        projectId="demo"
        onDelete={api.deleteRender}
        onClearCompleted={api.clearCompleted}
        onStartRender={() => {}}
        isRendering={api.isRendering}
        loadError={api.loadError}
        onRetryLoad={api.reloadRenders}
        ffmpeg={null}
        ffmpegChecking={false}
        onRecheckFfmpeg={() => {}}
      />
    ));
    await settle();
    const retry = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Retry",
    );
    expect(retry).toBeDefined();
    stubFetch([{ id: "seq", filename: "frames", kind: "directory", frameCount: 90, createdAt: 1 }]);
    await act(async () => {
      retry?.click();
    });
    await settle();
    expect(queue.api().loadError).toBeNull();
    expect(queue.api().jobs).toHaveLength(1);
    expect(queue.api().jobs[0]).toMatchObject({ id: "seq", frameCount: 90 });
  });

  it.each(["keep", "hide", "delete", "hide-unavailable"] as const)(
    "handles history before the POST response without duplicating or reviving a row (%s)",
    async (action) => {
      const renders: unknown[] = [];
      const fetchMock = stubFetch(renders);
      let deliver!: (response: Response) => void;
      fetchMock.mockImplementation((url: string, init?: RequestInit) =>
        init?.method === "POST"
          ? new Promise<Response>((resolve) => {
              deliver = resolve;
            })
          : Promise.resolve(String(url).endsWith("/renders") ? json({ renders }) : json({})),
      );
      queue = mountRenderQueue(useRenderQueue);
      await settle();
      let starting!: Promise<unknown>;
      act(() => {
        starting = queue!.api().startRender({ format: "png-sequence" });
      });
      renders.push({
        id: "seq-job",
        filename: "frames",
        kind: "directory",
        frameCount: 90,
        size: 100,
        createdAt: 1,
      });
      await act(async () => {
        await queue?.api().reloadRenders();
      });
      expect(queue.api().jobs).toHaveLength(1);
      if (action === "hide-unavailable")
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
          throw new Error("storage unavailable");
        });
      await act(async () => {
        if (action.startsWith("hide")) queue?.api().clearCompleted();
        if (action === "delete") await queue?.api().deleteRender("seq-job");
      });
      await act(async () => {
        deliver(json({ jobId: "seq-job", filename: "frames", status: "rendering" }));
        await starting;
      });
      expect(queue.api().jobs).toHaveLength(action === "keep" ? 1 : 0);
      if (action === "keep")
        expect(queue.api().jobs[0]).toMatchObject({
          id: "seq-job",
          filename: "frames",
          frameCount: 90,
          size: 100,
        });
    },
  );

  it.each(["unavailable", "overflow"] as const)(
    "keeps hidden rows suppressed during a delayed full reload when storage is %s",
    async (storage) => {
      const renders = Array.from({ length: storage === "overflow" ? 201 : 1 }, (_, index) => ({
        id: `seq-${index}`,
        filename: `frames-${index}`,
        createdAt: index,
      }));
      stubFetch(renders);
      queue = mountRenderQueue(useRenderQueue);
      await settle();
      expect(queue.api().jobs).toHaveLength(renders.length);
      let deliver!: (response: Response) => void;
      vi.stubGlobal(
        "fetch",
        vi.fn(
          () =>
            new Promise<Response>((resolve) => {
              deliver = resolve;
            }),
        ),
      );
      let loading!: Promise<void>;
      act(() => {
        loading = queue!.api().reloadRenders();
      });
      if (storage === "unavailable")
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
          throw new Error("storage unavailable");
        });
      act(() => {
        queue?.api().clearCompleted();
      });
      expect(queue.api().jobs).toEqual([]);
      await act(async () => {
        deliver(json({ renders }));
        await loading;
      });
      expect(queue.api().jobs).toEqual([]);
    },
  );

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

  it("refreshes the frame count on PNG completion without remounting or duplicating the session row", async () => {
    const renders: unknown[] = [];
    stubFetch(renders);
    let progress: ((event: { data: string }) => void) | undefined;
    vi.stubGlobal(
      "EventSource",
      class {
        close() {}
        addEventListener(_name: string, listener: typeof progress) {
          progress = listener;
        }
      },
    );
    queue = mountRenderQueue(useRenderQueue);
    await settle();
    await act(async () => {
      await queue?.api().startRender({ format: "png-sequence" });
    });
    renders.push({
      id: "seq-job",
      filename: "frames-output",
      kind: "directory",
      frameCount: 90,
      createdAt: 1,
      size: 100,
    });
    await act(async () => {
      progress?.({ data: '{"status":"complete","progress":100}' });
    });
    await settle();
    expect(queue.api().jobs).toHaveLength(1);
    expect(queue.api().jobs[0]).toMatchObject({
      id: "seq-job",
      filename: "frames-output",
      status: "complete",
      progress: 100,
      frameCount: 90,
    });
  });

  it("merges explicit history reloads without replacing live progress, errors, or status", async () => {
    const renders: unknown[] = [];
    stubFetch(renders);
    const emit = progressSource();
    queue = mountRenderQueue(useRenderQueue);
    await settle();
    await act(async () => {
      await queue?.api().startRender({ format: "png-sequence" });
    });
    await emit({ progress: 42, stage: "capture", error: "live warning" });
    renders.push({
      id: "seq-job",
      filename: "frames",
      kind: "directory",
      frameCount: 17,
      status: "complete",
      createdAt: 1,
    });
    await act(async () => {
      await queue?.api().reloadRenders();
    });
    expect(queue.api().jobs).toHaveLength(1);
    expect(queue.api().jobs[0]).toMatchObject({
      status: "rendering",
      progress: 42,
      stage: "capture",
      error: "live warning",
      filename: "frames",
      frameCount: 17,
    });
  });

  it.each(["hide", "delete"] as const)(
    "never revives a row after %s when completion metadata arrives late",
    async (action) => {
      stubFetch([]);
      const emit = progressSource();
      queue = mountRenderQueue(useRenderQueue);
      await settle();
      await act(async () => {
        await queue?.api().startRender({ format: "png-sequence" });
      });
      let deliver!: (response: Response) => void;
      vi.stubGlobal(
        "fetch",
        vi.fn((url: string, init?: RequestInit) =>
          init?.method === "DELETE"
            ? Promise.resolve(json({ deleted: true }))
            : String(url).endsWith("/renders")
              ? new Promise<Response>((resolve) => {
                  deliver = resolve;
                })
              : Promise.resolve(json({})),
        ),
      );
      await emit({ status: "complete", progress: 100 });
      await act(async () => {
        if (action === "hide") queue?.api().clearCompleted();
        else await queue?.api().deleteRender("seq-job");
      });
      expect(typeof deliver).toBe("function");
      await act(async () => {
        deliver(
          json({
            renders: [
              {
                id: "seq-job",
                filename: "seq-job",
                kind: "directory",
                frameCount: 90,
                createdAt: 1,
              },
            ],
          }),
        );
      });
      expect(queue.api().jobs).toEqual([]);
    },
  );

  it("leaves a completed render intact when the metadata request fails", async () => {
    stubFetch([]);
    const emit = progressSource();
    queue = mountRenderQueue(useRenderQueue);
    await settle();
    await act(async () => {
      await queue?.api().startRender({ format: "png-sequence" });
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    await emit({ status: "complete", progress: 100 });
    await settle();
    expect(queue.api().jobs[0]).toMatchObject({ id: "seq-job", status: "complete", progress: 100 });
    expect(queue.api().loadError).toBeNull();
  });

  it("ignores a late history response from another project", async () => {
    stubFetch([]);
    queue = mountRenderQueue(useRenderQueue);
    await settle();
    let deliver!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        String(url).includes("/demo/")
          ? new Promise<Response>((resolve) => {
              deliver = resolve;
            })
          : Promise.resolve(
              json({ renders: [{ id: "same", filename: "other-project", createdAt: 2 }] }),
            ),
      ),
    );
    let loading!: Promise<void>;
    act(() => {
      loading = queue!.api().reloadRenders();
    });
    queue.setProject("other");
    await settle();
    await act(async () => {
      deliver(json({ renders: [{ id: "same", filename: "wrong-project", createdAt: 1 }] }));
      await loading;
    });
    expect(queue.api().jobs).toHaveLength(1);
    expect(queue.api().jobs[0]?.filename).toBe("other-project");
  });

  it("ignores old-project progress even when the next project receives the same ID", async () => {
    stubFetch([]);
    const emit = progressSource();
    queue = mountRenderQueue(useRenderQueue);
    await settle();
    await act(async () => {
      await queue?.api().startRender({ format: "png-sequence" });
    });
    queue.setProject("other");
    await settle();
    expect(queue.api().jobs).toEqual([]);
    await act(async () => {
      await queue?.api().startRender({ format: "png-sequence" });
    });
    await emit({ status: "complete", progress: 100 }, 0);
    expect(queue.api().jobs).toHaveLength(1);
    expect(queue.api().jobs[0]).toMatchObject({ status: "rendering", progress: 0 });
  });
});
