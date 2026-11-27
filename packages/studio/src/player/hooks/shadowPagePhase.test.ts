// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { STUDIO_PREVIEW_PAGE_DEADLINE_MS } from "@hyperframes/core/studio-preview-mark";
import { noteFrameAdded, shadowPagePhase, waitsOnServer } from "./shadowPagePhase";

const GRACE_MS = 15_000;

function frame(doc: { URL: string; readyState: string } | null, src?: string, win: object = {}) {
  const iframe = document.createElement("iframe");
  if (src) iframe.setAttribute("src", src);
  Object.defineProperty(iframe, "isConnected", { value: true });
  Object.defineProperty(iframe, "contentDocument", { value: doc });
  Object.defineProperty(iframe, "contentWindow", { value: win });
  noteFrameAdded(iframe);
  return iframe;
}

const blank = { URL: "about:blank", readyState: "complete" };
const page = { URL: "http://127.0.0.1/preview", readyState: "complete" };

afterEach(() => vi.useRealTimers());

describe("a shadow frame's page", () => {
  it("names the step its page got to", () => {
    expect(shadowPagePhase(null)).toBe("no-frame");
    expect(shadowPagePhase(frame(null))).toBe("unreadable");
    expect(shadowPagePhase(frame(blank))).toBe("blank");
    expect(shadowPagePhase(frame({ ...page, readyState: "loading" }))).toBe("page-loading");
    expect(shadowPagePhase(frame(page, undefined, { __hyperframes: {} }))).toBe("scripts-waiting");
  });

  it("waits on the server while its addressed frame is blank, up to the server's page deadline", () => {
    vi.useFakeTimers();
    const asked = frame(blank, "/api/projects/demo/preview");
    expect(waitsOnServer(asked, GRACE_MS)).toBe(true);
    vi.advanceTimersByTime(STUDIO_PREVIEW_PAGE_DEADLINE_MS + GRACE_MS - 1);
    expect(waitsOnServer(asked, GRACE_MS)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(waitsOnServer(asked, GRACE_MS)).toBe(false);
  });

  it("does not wait on the server for a frame never given an address, or one whose page arrived", () => {
    expect(waitsOnServer(frame(blank), GRACE_MS)).toBe(false);
    expect(waitsOnServer(frame(page, "/api/projects/demo/preview"), GRACE_MS)).toBe(false);
  });
});
