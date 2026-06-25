// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the two preview-sync primitives so we can assert which path runCommit took.
// `patchRuntimeTweenInPlace` is the instant in-place patch; `applySoftReload` is
// the existing fallback. `extractGsapScriptText` is re-exported from the same
// module and used elsewhere in the hook — keep it a harmless stub.
const patchRuntimeTweenInPlace = vi.fn<(...args: unknown[]) => boolean>();
const applySoftReload = vi.fn<(...args: unknown[]) => string>();
const trackStudioEvent = vi.fn();

vi.mock("./gsapRuntimePatch", () => ({
  patchRuntimeTweenInPlace: (...args: unknown[]) => patchRuntimeTweenInPlace(...args),
}));
vi.mock("../utils/gsapSoftReload", () => ({
  applySoftReload: (...args: unknown[]) => applySoftReload(...args),
  extractGsapScriptText: () => "",
}));
vi.mock("../utils/studioTelemetry", () => ({
  trackStudioEvent: (...args: unknown[]) => trackStudioEvent(...args),
}));

// Tell React this is an act-capable environment so act(...) flushes effects
// without warning (React reads this global at call time).
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { DomEditSelection } from "../components/editor/domEditingTypes";
import type { MutationResult } from "./gsapScriptCommitTypes";
import { applyPreviewSync, useGsapScriptCommits } from "./useGsapScriptCommits";

// ── applyPreviewSync (pure preview-sync decision) ────────────────────────────

const FAKE_IFRAME = {} as HTMLIFrameElement;

function result(over: Partial<MutationResult> = {}): MutationResult {
  return { ok: true, scriptText: "tl.set('#a',{})", ...over };
}

describe("applyPreviewSync", () => {
  beforeEach(() => {
    patchRuntimeTweenInPlace.mockReset();
    applySoftReload.mockReset();
    trackStudioEvent.mockReset();
  });

  it("instantPatch + patch succeeds: skips both soft reload and full reload", () => {
    patchRuntimeTweenInPlace.mockReturnValue(true);
    const reloadPreview = vi.fn();

    applyPreviewSync(
      FAKE_IFRAME,
      result(),
      {
        label: "drag",
        softReload: true,
        instantPatch: { selector: "#a", change: { kind: "set", props: { x: 10 } } },
      },
      reloadPreview,
    );

    expect(patchRuntimeTweenInPlace).toHaveBeenCalledWith(FAKE_IFRAME, "#a", {
      kind: "set",
      props: { x: 10 },
    });
    expect(applySoftReload).not.toHaveBeenCalled();
    expect(reloadPreview).not.toHaveBeenCalled();
  });

  it("instantPatch + patch fails: falls back to the soft reload, passing onAsyncFailure", () => {
    patchRuntimeTweenInPlace.mockReturnValue(false);
    applySoftReload.mockReturnValue("applied");
    const reloadPreview = vi.fn();

    applyPreviewSync(
      FAKE_IFRAME,
      result({ scriptText: "SCRIPT" }),
      {
        label: "drag",
        softReload: true,
        instantPatch: { selector: "#a", change: { kind: "set", props: { x: 10 } } },
      },
      reloadPreview,
    );

    // reloadPreview is wired as onAsyncFailure (3rd arg) so a MotionPath-plugin
    // CDN load failure escalates to a full reload — but it is NOT called eagerly.
    expect(applySoftReload).toHaveBeenCalledWith(FAKE_IFRAME, "SCRIPT", reloadPreview);
    expect(reloadPreview).not.toHaveBeenCalled();
    // A successful instant patch is the fast path; here it missed → fallback event.
    expect(trackStudioEvent).toHaveBeenCalledWith(
      "gsap_instant_patch_fallback",
      expect.objectContaining({ selector: "#a" }),
    );
  });

  it('instantPatch + patch fails + soft reload "verify-failed": transient, does NOT escalate (U4)', () => {
    patchRuntimeTweenInPlace.mockReturnValue(false);
    applySoftReload.mockReturnValue("verify-failed");
    const reloadPreview = vi.fn();

    applyPreviewSync(
      FAKE_IFRAME,
      result({ scriptText: "SCRIPT" }),
      {
        label: "drag",
        softReload: true,
        instantPatch: { selector: "#a", change: { kind: "set", props: { x: 10 } } },
      },
      reloadPreview,
    );

    // U4: "verify-failed" is the TRANSIENT empty-timeline window — the live state
    // is correct, so we must NOT escalate to a full reload.
    expect(applySoftReload).toHaveBeenCalledWith(FAKE_IFRAME, "SCRIPT", reloadPreview);
    expect(reloadPreview).not.toHaveBeenCalled();
    // Telemetry records the suppressed transient (escalated: false).
    expect(trackStudioEvent).toHaveBeenCalledWith(
      "gsap_soft_reload_outcome",
      expect.objectContaining({
        origin: "preview_sync",
        result: "verify-failed",
        escalated: false,
      }),
    );
  });

  it('instantPatch + patch fails + soft reload "cannot-soft-reload": escalates to full reload', () => {
    patchRuntimeTweenInPlace.mockReturnValue(false);
    applySoftReload.mockReturnValue("cannot-soft-reload");
    const reloadPreview = vi.fn();

    applyPreviewSync(
      FAKE_IFRAME,
      result({ scriptText: "SCRIPT" }),
      {
        label: "drag",
        softReload: true,
        instantPatch: { selector: "#a", change: { kind: "set", props: { x: 10 } } },
      },
      reloadPreview,
    );

    // Structural failure: the preview is genuinely stale/broken → full reload.
    expect(applySoftReload).toHaveBeenCalledWith(FAKE_IFRAME, "SCRIPT", reloadPreview);
    expect(reloadPreview).toHaveBeenCalledTimes(1);
    expect(trackStudioEvent).toHaveBeenCalledWith(
      "gsap_soft_reload_outcome",
      expect.objectContaining({
        origin: "preview_sync",
        result: "cannot-soft-reload",
        escalated: true,
      }),
    );
  });

  it("no instantPatch + softReload + scriptText: soft reloads, passing onAsyncFailure", () => {
    applySoftReload.mockReturnValue("applied");
    const reloadPreview = vi.fn();

    applyPreviewSync(
      FAKE_IFRAME,
      result({ scriptText: "SCRIPT" }),
      { label: "x", softReload: true },
      reloadPreview,
    );

    expect(patchRuntimeTweenInPlace).not.toHaveBeenCalled();
    expect(applySoftReload).toHaveBeenCalledWith(FAKE_IFRAME, "SCRIPT", reloadPreview);
    expect(reloadPreview).not.toHaveBeenCalled();
    // "applied" emits no telemetry (only the failure paths do).
    expect(trackStudioEvent).not.toHaveBeenCalled();
  });

  it('no instantPatch + softReload "verify-failed": transient, does NOT escalate (U4)', () => {
    applySoftReload.mockReturnValue("verify-failed");
    const reloadPreview = vi.fn();

    applyPreviewSync(
      FAKE_IFRAME,
      result({ scriptText: "SCRIPT" }),
      { label: "x", softReload: true },
      reloadPreview,
    );

    // onAsyncFailure is wired, but the transient result does not trigger it.
    expect(applySoftReload).toHaveBeenCalledWith(FAKE_IFRAME, "SCRIPT", reloadPreview);
    expect(reloadPreview).not.toHaveBeenCalled();
    expect(trackStudioEvent).toHaveBeenCalledWith(
      "gsap_soft_reload_outcome",
      expect.objectContaining({ result: "verify-failed", escalated: false }),
    );
  });

  it('no instantPatch + softReload "cannot-soft-reload": escalates to full reload', () => {
    applySoftReload.mockReturnValue("cannot-soft-reload");
    const reloadPreview = vi.fn();

    applyPreviewSync(
      FAKE_IFRAME,
      result({ scriptText: "SCRIPT" }),
      { label: "x", softReload: true },
      reloadPreview,
    );

    expect(applySoftReload).toHaveBeenCalledWith(FAKE_IFRAME, "SCRIPT", reloadPreview);
    expect(reloadPreview).toHaveBeenCalledTimes(1);
    expect(trackStudioEvent).toHaveBeenCalledWith(
      "gsap_soft_reload_outcome",
      expect.objectContaining({ result: "cannot-soft-reload", escalated: true }),
    );
  });

  it("no instantPatch + no softReload: full reload (today's behavior)", () => {
    const reloadPreview = vi.fn();

    applyPreviewSync(FAKE_IFRAME, result(), { label: "x" }, reloadPreview);

    expect(patchRuntimeTweenInPlace).not.toHaveBeenCalled();
    expect(applySoftReload).not.toHaveBeenCalled();
    expect(reloadPreview).toHaveBeenCalledTimes(1);
  });
});

// ── runCommit (full hook path: persist + preview sync) ───────────────────────

type HookApi = ReturnType<typeof useGsapScriptCommits>;

let cleanup: (() => void) | null = null;

function renderCommitHook() {
  const reloadPreview = vi.fn();
  const onCacheInvalidate = vi.fn();
  const forceReloadSdkSession = vi.fn();
  const recordEdit = vi.fn(async () => {});
  const showToast = vi.fn();

  const captured: { api: HookApi | null } = { api: null };
  function Probe() {
    captured.api = useGsapScriptCommits({
      projectIdRef: { current: "proj-1" },
      activeCompPath: "index.html",
      previewIframeRef: { current: FAKE_IFRAME },
      editHistory: { recordEdit },
      domEditSaveTimestampRef: { current: 0 },
      reloadPreview,
      onCacheInvalidate,
      onFileContentChanged: undefined,
      showToast,
      sdkSession: null,
      writeProjectFile: undefined,
      forceReloadSdkSession,
    });
    return null;
  }

  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => {
    root.render(<Probe />);
  });
  cleanup = () => act(() => root.unmount());
  const hookApi = captured.api;
  if (!hookApi) throw new Error("hook did not initialize");
  return {
    api: hookApi,
    reloadPreview,
    onCacheInvalidate,
    forceReloadSdkSession,
    recordEdit,
    showToast,
  };
}

const selection: DomEditSelection = { id: "a", selector: "#a" } as DomEditSelection;

function mockFetchResult(over: Partial<MutationResult> = {}): void {
  const body: MutationResult = {
    ok: true,
    changed: true,
    before: "BEFORE",
    after: "AFTER",
    scriptText: "SCRIPT",
    ...over,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => body }) as unknown as Response),
  );
}

describe("runCommit — instantPatch wiring", () => {
  beforeEach(() => {
    patchRuntimeTweenInPlace.mockReset();
    applySoftReload.mockReset();
    trackStudioEvent.mockReset();
  });
  afterEach(() => {
    cleanup?.();
    cleanup = null;
    vi.unstubAllGlobals();
  });

  it("instantPatch succeeds: persists, invalidates cache, NO reload", async () => {
    patchRuntimeTweenInPlace.mockReturnValue(true);
    mockFetchResult();
    const deps = renderCommitHook();

    await act(async () => {
      await deps.api.commitMutation(
        selection,
        { x: 10 },
        {
          label: "drag",
          softReload: true,
          instantPatch: { selector: "#a", change: { kind: "set", props: { x: 10 } } },
        },
      );
    });

    expect(fetch).toHaveBeenCalledTimes(1); // source mutation persisted
    expect(deps.recordEdit).toHaveBeenCalledTimes(1);
    expect(deps.onCacheInvalidate).toHaveBeenCalledTimes(1);
    expect(applySoftReload).not.toHaveBeenCalled();
    expect(deps.reloadPreview).not.toHaveBeenCalled();
  });

  it("instantPatch fails: persists AND falls back to soft reload", async () => {
    patchRuntimeTweenInPlace.mockReturnValue(false);
    applySoftReload.mockReturnValue("applied");
    mockFetchResult();
    const deps = renderCommitHook();

    await act(async () => {
      await deps.api.commitMutation(
        selection,
        { x: 10 },
        {
          label: "drag",
          softReload: true,
          instantPatch: { selector: "#a", change: { kind: "set", props: { x: 10 } } },
        },
      );
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(applySoftReload).toHaveBeenCalledWith(FAKE_IFRAME, "SCRIPT", deps.reloadPreview);
    expect(deps.reloadPreview).not.toHaveBeenCalled();
    expect(deps.onCacheInvalidate).toHaveBeenCalledTimes(1);
  });

  it("no instantPatch: identical to today — soft reload when softReload+scriptText", async () => {
    applySoftReload.mockReturnValue("applied");
    mockFetchResult();
    const deps = renderCommitHook();

    await act(async () => {
      await deps.api.commitMutation(selection, { x: 10 }, { label: "drag", softReload: true });
    });

    expect(patchRuntimeTweenInPlace).not.toHaveBeenCalled();
    expect(applySoftReload).toHaveBeenCalledWith(FAKE_IFRAME, "SCRIPT", deps.reloadPreview);
    expect(deps.reloadPreview).not.toHaveBeenCalled();
  });
});
