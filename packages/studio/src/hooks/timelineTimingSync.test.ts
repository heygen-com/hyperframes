// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore } from "../player/store/playerStore";
import {
  captureDurationRollback,
  finishClipTimingFallback,
  readFileContent,
  shiftGsapPositions,
} from "./timelineTimingSync";

afterEach(() => {
  usePlayerStore.getState().reset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/**
 * Stub fetch: `/files/` reads return contents from the queue (repeating the
 * last entry), the GSAP-mutation endpoint answers with `gsapBody` (a thrown
 * Error rejects the call with a non-ok response).
 */
function stubFetch(fileContents: string[], gsapBody: unknown | Error) {
  let readIndex = 0;
  const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
    const url = requestUrl(input);
    if (url.includes("/files/")) {
      const content = fileContents[Math.min(readIndex, fileContents.length - 1)];
      readIndex += 1;
      return jsonResponse({ content });
    }
    if (url.includes("/gsap-mutations/")) {
      if (gsapBody instanceof Error) {
        return new Response(JSON.stringify({ error: gsapBody.message }), { status: 500 });
      }
      return jsonResponse(gsapBody);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function clipFallbackInput(overrides: {
  reloadPreview: () => void;
  recordEdit: (edit: unknown) => Promise<void>;
}) {
  return {
    iframe: null,
    reloadPreview: overrides.reloadPreview,
    projectId: "p1",
    targetPath: "index.html",
    domId: "clip",
    label: "Move timeline clip",
    recordEdit: overrides.recordEdit as never,
    edit: { kind: "shift", delta: 1 } as const,
  };
}

describe("finishClipTimingFallback failure domains", () => {
  it("still syncs the preview when the history-fold step fails after a successful mutation", async () => {
    // Mutation succeeds (server rewrite already on disk), but recordEdit (the
    // fold step) throws. The preview MUST still be synced — otherwise stale
    // GSAP positions stay on screen. iframe=null makes the sync observable as
    // one reloadPreview() call.
    stubFetch(["<before>", "<after>"], { mutated: true, scriptText: "tl.to()" });
    const reloadPreview = vi.fn();
    const foldError = new Error("history fold failed");
    const recordEdit = vi.fn(async () => {
      throw foldError;
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await finishClipTimingFallback(clipFallbackInput({ reloadPreview, recordEdit }));

    expect(recordEdit).toHaveBeenCalledTimes(1);
    expect(reloadPreview).toHaveBeenCalledTimes(1);
    // The fold error is surfaced, not swallowed silently.
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("GSAP"), foldError);
  });

  it("skips the preview sync when the MUTATION itself fails", async () => {
    stubFetch(["<before>"], new Error("mutation blew up"));
    const reloadPreview = vi.fn();
    const recordEdit = vi.fn(async () => {});
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await finishClipTimingFallback(clipFallbackInput({ reloadPreview, recordEdit }));

    expect(recordEdit).not.toHaveBeenCalled();
    expect(reloadPreview).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it("records the fold and syncs on the happy path", async () => {
    stubFetch(["<before>", "<after>"], { mutated: true, scriptText: "tl.to()" });
    const reloadPreview = vi.fn();
    const recordEdit = vi.fn(async () => {});

    await finishClipTimingFallback(clipFallbackInput({ reloadPreview, recordEdit }));

    expect(recordEdit).toHaveBeenCalledTimes(1);
    expect(reloadPreview).toHaveBeenCalledTimes(1);
  });
});

describe("captureDurationRollback", () => {
  it("restores the pre-sync duration only when it changed", () => {
    usePlayerStore.getState().setDuration(4);
    const rollback = captureDurationRollback(null);

    // No change → rollback is a no-op (no spurious set).
    rollback();
    expect(usePlayerStore.getState().duration).toBe(4);

    usePlayerStore.getState().setDuration(9);
    rollback();
    expect(usePlayerStore.getState().duration).toBe(4);
  });
});

describe("fetch URL encoding (user-influenced segments)", () => {
  it("URI-encodes the projectId in file reads", async () => {
    const fetchMock = stubFetch(["<html>"], {});
    await readFileContent("p/../evil", "index.html");
    expect(requestUrl(fetchMock.mock.calls[0]![0])).toBe(
      "/api/projects/p%2F..%2Fevil/files/index.html",
    );
  });

  it("URI-encodes the projectId in GSAP mutation calls", async () => {
    const fetchMock = stubFetch([], { mutated: false, scriptText: null });
    await shiftGsapPositions("p one", "scenes/intro.html", "clip", 1);
    expect(requestUrl(fetchMock.mock.calls[0]![0])).toBe(
      "/api/projects/p%20one/gsap-mutations/scenes%2Fintro.html",
    );
  });
});
