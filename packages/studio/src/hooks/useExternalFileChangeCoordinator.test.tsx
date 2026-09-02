// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudioFileConflictError } from "../utils/studioSaveDiagnostics";
import { markStudioWriteToken, resetStudioWriteTokens } from "../utils/studioFileVersion";
import { markSelfWrite, resetSelfWriteRegistry } from "./sdkSelfWriteRegistry";
import {
  useExternalFileChangeCoordinator,
  type ExternalFileChangeCoordinatorHandle,
} from "./useExternalFileChangeCoordinator";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type HotHandler = (payload?: unknown) => void;
type CoordinatorOptions = Parameters<typeof useExternalFileChangeCoordinator>[0];
const roots: Array<ReturnType<typeof createRoot>> = [];
let handler: HotHandler | null;

async function mountCoordinator(overrides: Partial<CoordinatorOptions> = {}) {
  const captured: { handle: ExternalFileChangeCoordinatorHandle | null } = { handle: null };
  const defaults: CoordinatorOptions = {
    projectId: "project-a",
    activeCompPath: "index.html",
    pendingTimelineEditPathRef: { current: new Set() },
    drainPendingChanges: vi.fn(async () => ({ status: "clean" as const })),
    reloadPreview: vi.fn(),
    reloadSdkSession: vi.fn(),
    persistConflictSnapshot: vi.fn(async () => undefined),
    discardPendingChanges: vi.fn(),
    overwriteConflict: vi.fn(async () => undefined),
    readProjectFile: vi.fn(async () => "external"),
    onAcceptedPersistedFileChange: vi.fn(),
  };
  const options = { ...defaults, ...overrides };
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  function Probe() {
    captured.handle = useExternalFileChangeCoordinator(options);
    return null;
  }
  await act(async () => root.render(<Probe />));
  return { captured, options };
}

describe("external file change coordinator", () => {
  beforeEach(() => {
    handler = null;
    resetStudioWriteTokens();
    resetSelfWriteRegistry();
    vi.stubGlobal("__HF_STUDIO_HOT_TEST_ADAPTER__", {
      on: (_event: string, next: HotHandler) => {
        handler = next;
      },
      off: () => {
        handler = null;
      },
    });
  });

  afterEach(async () => {
    while (roots.length > 0) await act(async () => roots.pop()?.unmount());
    vi.unstubAllGlobals();
  });

  it("drains before reloading Preview and SDK exactly once", async () => {
    const order: string[] = [];
    const { captured } = await mountCoordinator({
      drainPendingChanges: async () => {
        order.push("drain");
        return { status: "clean" };
      },
      onAcceptedPersistedFileChange: () => order.push("thumbnail"),
      reloadPreview: () => order.push("preview"),
      reloadSdkSession: () => order.push("sdk"),
    });
    await act(async () => handler?.({ path: "index.html", content: "external", version: "v2" }));
    expect(order).toEqual(["drain", "thumbnail", "preview", "sdk"]);
    expect(captured.handle?.blocked).toBeNull();
  });

  it("refreshes thumbnails once but suppresses Preview reload for an exact Studio write", async () => {
    const drainPendingChanges = vi.fn(async () => ({ status: "clean" as const }));
    const reloadPreview = vi.fn();
    const reloadSdkSession = vi.fn();
    const onAcceptedPersistedFileChange = vi.fn();
    await mountCoordinator({
      drainPendingChanges,
      reloadPreview,
      reloadSdkSession,
      onAcceptedPersistedFileChange,
    });
    markStudioWriteToken("studio-write-1");
    const payload = {
      path: "index.html",
      content: "studio",
      version: "v2",
      writeToken: "studio-write-1",
    };
    await act(async () => handler?.(payload));
    await act(async () => handler?.(payload));
    expect(drainPendingChanges).not.toHaveBeenCalled();
    expect(reloadPreview).not.toHaveBeenCalled();
    expect(reloadSdkSession).not.toHaveBeenCalled();
    expect(onAcceptedPersistedFileChange).toHaveBeenCalledOnce();
    expect(onAcceptedPersistedFileChange).toHaveBeenCalledWith("index.html");
  });

  it("accepts a matching content echo without a write token and suppresses every reload", async () => {
    const drainPendingChanges = vi.fn(async () => ({ status: "clean" as const }));
    const reloadPreview = vi.fn();
    const reloadSdkSession = vi.fn();
    const onAcceptedPersistedFileChange = vi.fn();
    await mountCoordinator({
      drainPendingChanges,
      reloadPreview,
      reloadSdkSession,
      onAcceptedPersistedFileChange,
    });
    markSelfWrite("index.html", "studio content");

    await act(async () =>
      handler?.({ path: "index.html", content: "studio content", version: "v2" }),
    );

    expect(onAcceptedPersistedFileChange).toHaveBeenCalledOnce();
    expect(onAcceptedPersistedFileChange).toHaveBeenCalledWith("index.html");
    expect(drainPendingChanges).not.toHaveBeenCalled();
    expect(reloadPreview).not.toHaveBeenCalled();
    expect(reloadSdkSession).not.toHaveBeenCalled();
  });

  it("does not suppress a racing external write by path alone", async () => {
    const pendingTimelineEditPathRef = { current: new Set(["index.html"]) };
    const drainPendingChanges = vi.fn(async () => ({ status: "clean" as const }));
    const reloadPreview = vi.fn();
    const reloadSdkSession = vi.fn();
    await mountCoordinator({
      pendingTimelineEditPathRef,
      drainPendingChanges,
      reloadPreview,
      reloadSdkSession,
    });
    await act(async () => handler?.({ path: "index.html", content: "agent edit", version: "v2" }));
    expect(pendingTimelineEditPathRef.current).not.toContain("index.html");
    expect(drainPendingChanges).toHaveBeenCalledOnce();
    expect(reloadPreview).toHaveBeenCalledOnce();
    expect(reloadSdkSession).toHaveBeenCalledOnce();
  });

  it("blocks both reloads and retains a complete conflict", async () => {
    const conflict = new StudioFileConflictError({
      filePath: "index.html",
      currentVersion: "v2",
      currentContent: "external",
      attemptedContent: "studio",
    });
    const persistConflictSnapshot = vi.fn(async () => undefined);
    const onAcceptedPersistedFileChange = vi.fn();
    const { captured, options } = await mountCoordinator({
      drainPendingChanges: async () => ({ status: "conflict", error: conflict }),
      persistConflictSnapshot,
      onAcceptedPersistedFileChange,
    });
    await act(async () => handler?.({ path: "index.html", content: "external", version: "v2" }));
    expect(persistConflictSnapshot).toHaveBeenCalledWith("project-a", conflict);
    expect(captured.handle?.blocked).toMatchObject({ status: "conflict", error: conflict });
    expect(options.reloadPreview).not.toHaveBeenCalled();
    expect(options.reloadSdkSession).not.toHaveBeenCalled();
    expect(onAcceptedPersistedFileChange).not.toHaveBeenCalled();

    await act(async () => captured.handle?.useExternalFile());
    expect(onAcceptedPersistedFileChange).toHaveBeenCalledOnce();
    expect(options.reloadPreview).toHaveBeenCalledOnce();
    expect(options.reloadSdkSession).toHaveBeenCalledOnce();
  });

  it("ignores stale drain completion after a newer generation", async () => {
    const drains: Array<(result: { status: "clean" }) => void> = [];
    const { options } = await mountCoordinator({
      drainPendingChanges: () => new Promise((resolve) => drains.push(resolve)),
    });
    act(() => {
      handler?.({ path: "index.html", content: "first", version: "v2" });
      handler?.({ path: "index.html", content: "second", version: "v3" });
    });
    await act(async () => drains[0]?.({ status: "clean" }));
    expect(options.reloadPreview).not.toHaveBeenCalled();
    await act(async () => drains[1]?.({ status: "clean" }));
    expect(options.reloadPreview).toHaveBeenCalledOnce();
    expect(options.reloadSdkSession).toHaveBeenCalledOnce();
  });

  it("restores a durable unresolved conflict after remount", async () => {
    const { captured } = await mountCoordinator({
      recoveryFilePath: "index.html",
      loadConflictSnapshot: vi.fn(async () => ({
        kind: "conflict" as const,
        projectId: "project-a",
        filePath: "index.html",
        externalVersion: "v2",
        externalContent: "external",
        studioContent: "studio",
        createdAt: 100,
      })),
    });
    await vi.waitFor(() => expect(captured.handle?.blocked?.status).toBe("conflict"));
    expect(captured.handle?.blocked).toMatchObject({
      error: { currentContent: "external", attemptedContent: "studio" },
    });
  });

  it("retains the final local candidate when a drain fails", async () => {
    const failure = new Error("network unavailable");
    const persistFailureSnapshot = vi.fn(async () => undefined);
    const deleteConflictSnapshot = vi.fn(async () => undefined);
    const onAcceptedPersistedFileChange = vi.fn();
    const { captured } = await mountCoordinator({
      drainPendingChanges: vi
        .fn()
        .mockResolvedValueOnce({ status: "failed" as const, error: failure })
        .mockResolvedValueOnce({ status: "clean" as const }),
      getPendingCandidate: () => ({ path: "index.html", content: "final local candidate" }),
      persistFailureSnapshot,
      deleteConflictSnapshot,
      onAcceptedPersistedFileChange,
    });
    await act(async () => handler?.({ path: "index.html" }));
    expect(captured.handle?.blocked).toMatchObject({
      status: "failed",
      error: failure,
      studioContent: "final local candidate",
    });
    expect(persistFailureSnapshot).toHaveBeenCalledWith(
      "project-a",
      "index.html",
      "final local candidate",
      null,
      null,
      failure,
    );
    expect(onAcceptedPersistedFileChange).not.toHaveBeenCalled();
    await act(async () => captured.handle?.retry());
    expect(deleteConflictSnapshot).toHaveBeenCalledWith("project-a", "index.html");
    expect(onAcceptedPersistedFileChange).toHaveBeenCalledOnce();
  });

  it("restores and overwrites from a durable failed draft", async () => {
    const overwriteConflict = vi.fn(async () => undefined);
    const onAcceptedPersistedFileChange = vi.fn();
    const { captured } = await mountCoordinator({
      recoveryFilePath: "index.html",
      overwriteConflict,
      onAcceptedPersistedFileChange,
      loadConflictSnapshot: vi.fn(async () => ({
        kind: "failed" as const,
        projectId: "project-a",
        filePath: "index.html",
        externalVersion: "v2",
        externalContent: "external",
        studioContent: "recover me",
        failureMessage: "network unavailable",
        createdAt: 100,
      })),
    });
    await vi.waitFor(() => expect(captured.handle?.blocked?.status).toBe("failed"));
    expect(captured.handle?.blocked).toMatchObject({
      studioContent: "recover me",
      recovered: true,
    });
    await act(async () => captured.handle?.keepStudioFile());
    expect(overwriteConflict).toHaveBeenCalledWith(
      expect.objectContaining({ attemptedContent: "recover me", currentVersion: "v2" }),
    );
    expect(onAcceptedPersistedFileChange).not.toHaveBeenCalled();

    markStudioWriteToken("keep-studio-write");
    await act(async () =>
      handler?.({
        path: "index.html",
        content: "recover me",
        version: "v3",
        writeToken: "keep-studio-write",
      }),
    );
    expect(onAcceptedPersistedFileChange).toHaveBeenCalledOnce();
  });
});
