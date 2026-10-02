import { afterEach, describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../player";
import { requestFreezeFrame } from "./useFreezeFrame";

afterEach(() => vi.unstubAllGlobals());

const element: TimelineElement = {
  id: "talk",
  domId: "talk",
  tag: "video",
  start: 5,
  duration: 6,
  track: 0,
  parentCompositionStart: 4,
};

function stubFetch(freezeResponse: { status: number; body: unknown }) {
  const calls: Array<{ url: string; body: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
      if (url.includes("/files/")) return new Response(JSON.stringify({ version: "v1" }));
      return new Response(JSON.stringify(freezeResponse.body), { status: freezeResponse.status });
    }),
  );
  return calls;
}

describe("requestFreezeFrame", () => {
  it("posts the clip target, file version and an authored-time playhead", async () => {
    const calls = stubFetch({ status: 200, body: { before: "a", after: "b", version: "v2" } });
    const result = await requestFreezeFrame({
      projectId: "p",
      path: "scene.html",
      element,
      playhead: 7.5,
    });
    expect(result).toEqual({ before: "a", after: "b", version: "v2" });
    const post = calls[1];
    expect(post?.url).toContain("/file-mutations/freeze-frame");
    expect(post?.body).toMatchObject({
      path: "scene.html",
      expectedVersion: "v1",
      target: { id: "talk" },
      playhead: 3.5,
    });
  });

  it("surfaces the server's error", async () => {
    stubFetch({ status: 400, body: { error: "Move the playhead inside a video clip to freeze" } });
    await expect(
      requestFreezeFrame({ projectId: "p", path: "index.html", element, playhead: 7 }),
    ).rejects.toThrow("Move the playhead inside a video clip to freeze");
  });
});
