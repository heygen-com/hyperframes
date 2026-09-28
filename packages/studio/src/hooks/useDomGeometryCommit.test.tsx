// @vitest-environment happy-dom
import { act, createElement, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useDomGeometryCommit,
  usePlayerStore,
  type DomEditOverlayProps,
  type UseDomGeometryCommitOptions,
} from "../index";
import { makeSelection } from "./domSelectionTestHarness";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

vi.mock("../utils/studioTelemetry", () => ({ trackStudioEvent: vi.fn() }));

const SOURCE = '<div id="card">Card</div><div id="other">Other</div>';

/** A warm parse where only another element animates, and a GSAP writer answering `status`. */
function stubServer(status = 200) {
  const mutations: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const json = (body: unknown, code = 200) =>
        new Response(JSON.stringify(body), {
          status: code,
          headers: { "content-type": "application/json" },
        });
      if (url.includes("/api/projects/p1/gsap-animations/")) {
        return json({
          animations: [
            {
              id: "other-fade",
              targetSelector: "#other",
              method: "to",
              position: 0,
              duration: 1,
              properties: { opacity: 1 },
              propertyGroup: "opacity",
            },
          ],
        });
      }
      if (url.includes("/api/projects/p1/gsap-mutations/")) {
        mutations.push(JSON.parse(String(init?.body)));
        if (status !== 200) return json({ error: "refused" }, status);
        return json({ ok: true, changed: true, before: "BEFORE", after: "AFTER" });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }),
  );
  return mutations;
}

function renderHost(options: Partial<UseDomGeometryCommitOptions> = {}) {
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const doc = iframe.contentDocument;
  if (!doc) throw new Error("Expected iframe document");
  doc.body.innerHTML = SOURCE;
  const element = doc.getElementById("card") as HTMLElement;
  const recordEdit = vi.fn(async () => {});
  const api: { current: ReturnType<typeof useDomGeometryCommit> | null } = { current: null };
  function Host() {
    const iframeRef = useRef<HTMLIFrameElement | null>(iframe);
    api.current = useDomGeometryCommit({
      projectId: "p1",
      iframeRef,
      writeProjectFile: vi.fn(async () => {}),
      recordEdit,
      reloadPreview: vi.fn(),
      ...options,
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Host)));
  const hook = () => {
    if (!api.current) throw new Error("Expected the hook to render");
    return api.current;
  };
  return { element, recordEdit, hook, unmount: () => act(() => root.unmount()) };
}

beforeEach(() => {
  usePlayerStore.setState({ previewBooted: true, timelineProjectId: "p1" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("useDomGeometryCommit, from the package entry", () => {
  it("plugs into DomEditOverlay and saves a move as one GSAP write and one undo step", async () => {
    const mutations = stubServer();
    const { element, recordEdit, hook, unmount } = renderHost();
    const overlayCommits: Pick<
      DomEditOverlayProps,
      "onPathOffsetCommit" | "onGroupPathOffsetCommit" | "onBoxSizeCommit" | "onRotationCommit"
    > = {
      onPathOffsetCommit: hook().commitPathOffset,
      onGroupPathOffsetCommit: hook().commitGroupPathOffset,
      onBoxSizeCommit: hook().commitBoxSize,
      onRotationCommit: hook().commitRotation,
    };

    const outcome = await overlayCommits.onPathOffsetCommit(makeSelection("card", element), {
      x: 40,
      y: 20,
    });

    expect(outcome).toEqual({ ok: true });
    expect(mutations).toEqual([
      expect.objectContaining({ type: "add", targetSelector: "#card", method: "set" }),
    ]);
    expect(recordEdit).toHaveBeenCalledTimes(1);
    expect(recordEdit).toHaveBeenCalledWith(
      expect.objectContaining({ files: { "index.html": { before: "BEFORE", after: "AFTER" } } }),
    );
    unmount();
  });

  it("rejects a move the server refuses, so the overlay undoes it", async () => {
    stubServer(500);
    const showToast = vi.fn();
    const { element, recordEdit, hook, unmount } = renderHost({ showToast });

    await expect(
      hook().commitPathOffset(makeSelection("card", element), { x: 40, y: 20 }),
    ).rejects.toThrow();
    expect(recordEdit).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(expect.any(String), "error");
    unmount();
  });

  it("rejects without a project and writes nothing", async () => {
    const mutations = stubServer();
    const { element, hook, unmount } = renderHost({ projectId: null });

    await expect(
      hook().commitRotation(makeSelection("card", element), { angle: 15 }),
    ).rejects.toThrow("No project is open");
    expect(mutations).toHaveLength(0);
    unmount();
  });
});
