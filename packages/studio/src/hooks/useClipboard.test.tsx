// @vitest-environment happy-dom

import React, { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  buildWebCaptureText,
  type WebCaptureResourceMaterializer,
} from "@hyperframes/core/web-capture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DomEditSelection } from "../components/editor/domEditing";
import { usePlayerStore } from "../player";
import { useClipboard } from "./useClipboard";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const timelineInsertion = vi.hoisted(() => vi.fn());
vi.mock("../utils/timelineCompositionInsert", () => ({
  commitTimelineCompositionInsertion: timelineInsertion,
}));

const PNG_DATA =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const PNG_SHA256 = "431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460";
const materializeResource: WebCaptureResourceMaterializer = async (_bytes, inspected) => inspected;

type ClipboardHandlers = ReturnType<typeof useClipboard>["nativeClipboardHandlers"];

function transfer(entries: Record<string, string>): DataTransfer {
  return {
    getData: vi.fn((type: string) => entries[type] ?? ""),
    setData: vi.fn(),
  } as unknown as DataTransfer;
}

function pasteEvent(data: DataTransfer) {
  return {
    clipboardData: data,
    preventDefault: vi.fn(),
  } as unknown as ClipboardEvent;
}

async function captureText(): Promise<string> {
  const result = await buildWebCaptureText(
    {
      artifact: {
        kind: "still",
        resourceId: "still-1",
        width: 1,
        height: 1,
        completeness: "complete",
      },
      resources: [
        {
          id: "still-1",
          kind: "image",
          mime: "image/png",
          bytes: 68,
          sha256: PNG_SHA256,
          data: PNG_DATA,
          width: 1,
          height: 1,
        },
      ],
      diagnostics: [],
      claims: {
        sourceFrame: { width: 1280, height: 720, devicePixelRatio: 1 },
        time: { kind: "locked-frame", atMs: 0 },
        reflow: "fixed-viewport",
      },
    },
    { materializeResource },
  );
  if (!result.ok) throw new Error(result.code);
  return result.text;
}

describe("useClipboard native browser capture", () => {
  let root: Root;
  let host: HTMLDivElement;
  let handlers: ClipboardHandlers;
  const writeProjectFile = vi.fn(async (_path: string, _content: string) => undefined);
  const recordEdit = vi.fn(async () => undefined);
  const refreshFileTree = vi.fn(async () => undefined);
  const reloadPreview = vi.fn();
  const forceReloadSdkSession = vi.fn();
  const showToast = vi.fn();

  function Harness() {
    handlers = useClipboard({
      projectId: "project-1",
      activeCompPath: "index.html",
      domEditSelectionRef: useRef<DomEditSelection | null>(null),
      showToast,
      writeProjectFile,
      recordEdit,
      refreshFileTree,
      forceReloadSdkSession,
      domEditSaveTimestampRef: useRef(0),
      reloadPreview,
      handleTimelineElementDelete: vi.fn(async () => undefined),
      handleDomEditElementDelete: vi.fn(async () => undefined),
      previewIframeRef: useRef<HTMLIFrameElement | null>(null),
    }).nativeClipboardHandlers;
    return null;
  }

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    usePlayerStore.getState().reset();
    usePlayerStore.getState().setCurrentTime(7.25);
    Object.defineProperty(globalThis, "createImageBitmap", {
      configurable: true,
      value: vi.fn(async () => ({ width: 1, height: 1, close: vi.fn() })),
    });
    timelineInsertion.mockImplementation(async (input) => {
      input.selectHost(`${input.targetPath}#server-owned-host`);
      input.resync?.();
      input.refresh();
    });
    act(() => root.render(<Harness />));
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("claims a routed v2 paste synchronously, then creates and inserts one Still", async () => {
    const event = pasteEvent(transfer({ "text/plain": await captureText() }));

    handlers.paste(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(refreshFileTree).toHaveBeenCalledTimes(1));
    expect(writeProjectFile).toHaveBeenCalledTimes(1);
    const [childPath, childSource] = writeProjectFile.mock.calls[0]!;
    expect(childPath).toMatch(/^compositions\/web-captures\/capture-.+\.html$/);
    expect(childSource).toContain(`src="data:image/png;base64,${PNG_DATA}"`);
    expect(timelineInsertion).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        targetPath: "index.html",
        sourcePath: childPath,
        start: 7.25,
        track: 0,
      }),
    );
    expect(reloadPreview).toHaveBeenCalledTimes(1);
    expect(forceReloadSdkSession).toHaveBeenCalledTimes(1);
    expect(usePlayerStore.getState().selectedElementId).toBe("index.html#server-owned-host");
    expect(showToast).toHaveBeenCalledWith("Pasted browser Still", "info");
  });

  it("leaves unrelated clipboard text to the native target", () => {
    const event = pasteEvent(transfer({ "text/plain": "ordinary text" }));

    handlers.paste(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(writeProjectFile).not.toHaveBeenCalled();
  });
});
