// @vitest-environment happy-dom
import { act, type MouseEvent } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFrameCapture } from "./useFrameCapture";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

/** One handle per render, so the assertions read a list instead of a mutated binding. */
const rendered: ReturnType<typeof useFrameCapture>[] = [];
const showToast = vi.fn();
const waitForPendingDomEditSaves = vi.fn(async () => {});

function Probe() {
  rendered.push(
    useFrameCapture({
      projectId: "p1",
      activeCompPath: "index.html",
      showToast,
      waitForPendingDomEditSaves,
    }),
  );
  return null;
}

function latest() {
  const handle = rendered[rendered.length - 1];
  if (!handle) throw new Error("hook did not render");
  return handle;
}

const clickEvent = { preventDefault: vi.fn() } as unknown as MouseEvent<HTMLAnchorElement>;

let unmount: () => void;

beforeEach(() => {
  rendered.length = 0;
  vi.clearAllMocks();
  const root = createRoot(document.createElement("div"));
  act(() => root.render(<Probe />));
  unmount = () => act(() => root.unmount());
});

afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useFrameCapture", () => {
  it("downloads the captured frame and leaves the button usable again", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, blob: async () => new Blob(["png"]) })),
    );
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:frame");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await act(async () => {
      await latest().handleCaptureFrameClick(clickEvent);
    });

    expect(click).toHaveBeenCalledTimes(1);
    expect(showToast).not.toHaveBeenCalled();
    expect(latest().capturing).toBe(false);
  });

  it("reports the server's own message when the capture request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({ error: "renderer crashed" }),
      })),
    );

    await act(async () => {
      await latest().handleCaptureFrameClick(clickEvent);
    });

    expect(showToast).toHaveBeenCalledWith("renderer crashed", "error");
    // The latch is lowered on the failure path too, or one bad capture disables
    // the button for the rest of the session.
    expect(latest().capturing).toBe(false);
  });

  it("falls back to the status code when the failure body is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => {
          throw new Error("not json");
        },
      })),
    );

    await act(async () => {
      await latest().handleCaptureFrameClick(clickEvent);
    });

    expect(showToast).toHaveBeenCalledWith("Capture failed (503)", "error");
  });

  it("reports a save-queue failure without ever issuing the request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    waitForPendingDomEditSaves.mockRejectedValueOnce(new Error("Save queue timed out"));

    await act(async () => {
      await latest().handleCaptureFrameClick(clickEvent);
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("Save queue timed out", "error");
    expect(latest().capturing).toBe(false);
  });
});
