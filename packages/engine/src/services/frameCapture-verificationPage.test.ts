import { afterEach, describe, expect, it, vi } from "vitest";
import type { Page } from "puppeteer-core";
import { MEDIA_RENDER_ID_ATTR } from "@hyperframes/core";
import { createStaticVerificationPage } from "./frameCapture.js";
import type { CaptureSession } from "./frameCapture.js";

type Registered = { fn: (...args: unknown[]) => void; args: unknown[] };

/** A page that records its on-new-document scripts and stops at navigation. */
function recordingSession(skipReadinessVideoIds: string[]) {
  const registered: Registered[] = [];
  const page = {
    evaluateOnNewDocument: async (fn: Registered["fn"], ...args: unknown[]) => {
      registered.push({ fn, args });
    },
    setViewport: async () => undefined,
    goto: async () => {
      throw new Error("stopped at navigation");
    },
    close: async () => undefined,
  } as unknown as Page;
  const session = {
    browser: { newPage: async () => page },
    serverUrl: "http://127.0.0.1:1",
    options: { width: 10, height: 10, fps: 30, format: "jpeg", skipReadinessVideoIds },
  } as unknown as CaptureSession;
  return { session, registered };
}

describe("createStaticVerificationPage media setup", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("installs the render-id bridge, so videos that share a plain id stay distinct", async () => {
    const { session, registered } = recordingSession([]);
    await expect(createStaticVerificationPage(session)).rejects.toThrow("stopped at navigation");

    const win: Record<string, unknown> = {};
    vi.stubGlobal("window", win);
    for (const { fn, args } of registered) if (typeof fn === "function") fn(...args);

    const first = { id: "hf-video-0", getAttribute: () => null };
    const second = {
      id: "hf-video-0",
      getAttribute: (name: string) => (name === MEDIA_RENDER_ID_ATTR ? "hf-video-1" : null),
    };
    const mediaId = win.__hfMediaId as (el: unknown) => string;
    expect(mediaId(first)).toBe("hf-video-0");
    expect(mediaId(second)).toBe("hf-video-1");
  });

  it("holds the render-frame videos the render page holds", async () => {
    const { session, registered } = recordingSession(["clip"]);
    await expect(createStaticVerificationPage(session)).rejects.toThrow("stopped at navigation");

    expect(
      registered.some(
        ({ args }) => args[0]?.toString() === "clip" && args[1] === MEDIA_RENDER_ID_ATTR,
      ),
    ).toBe(true);
  });
});
