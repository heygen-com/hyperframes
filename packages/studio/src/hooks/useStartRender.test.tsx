// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnqueueRenderOptions } from "../components/renders/useRenderQueue";
import type { StartRenderAction } from "./useStartRender";

const { trackStudioRenderStart } = vi.hoisted(() => ({
  trackStudioRenderStart: vi.fn(),
}));

vi.mock("../telemetry/events", () => ({ trackStudioRenderStart }));

import { useStartRender } from "./useStartRender";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

let host: HTMLDivElement;
let root: Root;
let action: StartRenderAction | undefined;

function Harness({
  enqueueRender,
  isRendering = false,
  waitForPendingDomEditSaves,
  showToast,
}: {
  enqueueRender: (options: EnqueueRenderOptions) => Promise<void>;
  isRendering?: boolean;
  waitForPendingDomEditSaves: () => Promise<void>;
  showToast: (message: string, tone?: "error" | "info") => void;
}) {
  action = useStartRender({
    enqueueRender,
    isRendering,
    waitForPendingDomEditSaves,
    showToast,
  });
  return null;
}

function getAction(): StartRenderAction {
  if (!action) throw new Error("start render action was not initialized");
  return action;
}

beforeEach(() => {
  action = undefined;
  trackStudioRenderStart.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

describe("useStartRender", () => {
  it("ignores a rapid second call while the first render is starting", async () => {
    let releaseEnqueue: (() => void) | undefined;
    const enqueueRender = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseEnqueue = resolve;
        }),
    );
    const waitForPendingDomEditSaves = vi.fn(async () => {});
    const showToast = vi.fn();
    act(() => {
      root.render(
        <Harness
          enqueueRender={enqueueRender}
          waitForPendingDomEditSaves={waitForPendingDomEditSaves}
          showToast={showToast}
        />,
      );
    });

    const startRender = getAction();
    const first = startRender("scenes/intro.html", { format: "webm", fps: 60 });
    const second = startRender("scenes/outro.html");
    await Promise.resolve();

    expect(waitForPendingDomEditSaves).toHaveBeenCalledOnce();
    expect(enqueueRender).toHaveBeenCalledOnce();
    expect(enqueueRender).toHaveBeenCalledWith({
      composition: "scenes/intro.html",
      format: "webm",
      quality: "standard",
      fps: 60,
    });
    expect(trackStudioRenderStart).toHaveBeenCalledOnce();
    expect(trackStudioRenderStart).toHaveBeenCalledWith({
      composition: "scenes/intro.html",
      format: "webm",
      quality: "standard",
      fps: 60,
      resolution: undefined,
    });

    if (!releaseEnqueue) throw new Error("enqueue did not start");
    releaseEnqueue();
    await Promise.all([first, second]);
  });

  it("does not start another render while the queue is rendering", async () => {
    const enqueueRender = vi.fn(async () => {});
    const waitForPendingDomEditSaves = vi.fn(async () => {});
    act(() => {
      root.render(
        <Harness
          enqueueRender={enqueueRender}
          isRendering
          waitForPendingDomEditSaves={waitForPendingDomEditSaves}
          showToast={() => {}}
        />,
      );
    });

    await getAction()(undefined);

    expect(waitForPendingDomEditSaves).not.toHaveBeenCalled();
    expect(enqueueRender).not.toHaveBeenCalled();
    expect(trackStudioRenderStart).not.toHaveBeenCalled();
  });

  it("reports a start failure through the shared toast", async () => {
    const showToast = vi.fn();
    act(() => {
      root.render(
        <Harness
          enqueueRender={vi.fn(async () => {})}
          waitForPendingDomEditSaves={vi.fn(async () => {
            throw new Error("Save failed");
          })}
          showToast={showToast}
        />,
      );
    });

    await getAction()(undefined);

    expect(showToast).toHaveBeenCalledWith("Save failed", "error");
    expect(trackStudioRenderStart).not.toHaveBeenCalled();
  });
});
