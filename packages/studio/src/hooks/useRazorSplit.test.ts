// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../player";
import { usePlayerStore } from "../player";
import { useRazorSplit } from "./useRazorSplit";
import { createPersistentEditHistoryStore } from "./usePersistentEditHistory";
import { createEmptyEditHistory } from "../utils/editHistory";
import type { EditHistoryStorageAdapter } from "../utils/editHistoryStorage";
import { createSplitFetchMock, mountProbe } from "./useRazorSplit.testHelpers";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT_FILE = "index.html";
const SUBCOMP_FILE = "scenes/intro.html";

// A root-level clip lives in index.html and is authored in local time already.
const rootElement: TimelineElement = {
  id: "root-clip",
  tag: "div",
  start: 0,
  duration: 10,
  track: 0,
  domId: "root-clip",
  sourceFile: ROOT_FILE,
  timingSource: "authored",
};

// An expanded sub-comp child: `start` is in MASTER coordinates (offset by the
// host's master start), `sourceFile` is the sub-comp, and `expandedParentStart`
// is that host master start. Its authored time in the file is start - basis.
const expandedChild: TimelineElement = {
  id: "child-clip",
  tag: "div",
  start: 2,
  duration: 6,
  track: 1,
  domId: "child-clip",
  sourceFile: SUBCOMP_FILE,
  timingSource: "authored",
  expandedParentStart: 2,
};

interface SplitRequest {
  path: string;
  splitTime: number;
  elementStart: number;
  elementDuration: number;
}

type SingleSplit = (element: TimelineElement, splitTime: number) => Promise<void>;
type SplitAll = (splitTime: number) => Promise<void>;

interface Harness {
  splitRequests: SplitRequest[];
  singleRef: { current: SingleSplit | undefined };
  allRef: { current: SplitAll | undefined };
  root: ReturnType<typeof mountProbe>;
}

function mountRazorSplit(): Harness {
  const disk: Record<string, string> = {
    [ROOT_FILE]: `<div class="clip" id="root-clip" data-start="0" data-duration="10"></div>`,
    [SUBCOMP_FILE]: `<div class="clip" id="child-clip" data-start="0" data-duration="6"></div>`,
  };
  const splitRequests: SplitRequest[] = [];

  const fetchMock = createSplitFetchMock(disk, (path, body) => {
    splitRequests.push({
      path,
      splitTime: body.splitTime,
      elementStart: body.elementStart,
      elementDuration: body.elementDuration,
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  const singleRef: { current: SingleSplit | undefined } = { current: undefined };
  const allRef: { current: SplitAll | undefined } = { current: undefined };

  function Component() {
    const { handleRazorSplit, handleRazorSplitAll } = useRazorSplit({
      projectId: "p1",
      activeCompPath: ROOT_FILE,
      showToast: () => {},
      writeProjectFile: async (path, content) => {
        disk[path] = content;
      },
      recordEdit: async () => {},
      domEditSaveTimestampRef: { current: 0 },
      reloadPreview: () => {},
    });
    singleRef.current = handleRazorSplit;
    allRef.current = handleRazorSplitAll;
    return null;
  }

  const root = mountProbe(Component);
  return { splitRequests, singleRef, allRef, root };
}

afterEach(() => {
  document.body.innerHTML = "";
  usePlayerStore.setState({ elements: [] });
  vi.unstubAllGlobals();
});

describe("useRazorSplit — sub-comp coordinate rebasing", () => {
  let harness: Harness;
  beforeEach(() => {
    harness = mountRazorSplit();
  });
  afterEach(() => {
    act(() => harness.root.unmount());
  });

  it("rebases an expanded sub-comp child split into the sub-comp's local time", async () => {
    // Master split time T = 5; host starts at 2, so local time is 3.
    await act(async () => {
      await harness.singleRef.current!(expandedChild, 5);
    });

    expect(harness.splitRequests).toHaveLength(1);
    const req = harness.splitRequests[0];
    expect(req.path).toBe(SUBCOMP_FILE);
    expect(req.splitTime).toBe(3); // 5 - expandedParentStart(2), NOT 5
    expect(req.elementStart).toBe(0); // 2 - 2, NOT the master start 2
    expect(req.elementDuration).toBe(6);
  });

  it("leaves a root-level clip's coordinates unchanged", async () => {
    // Master split time T = 4; no expandedParentStart, so nothing is rebased.
    await act(async () => {
      await harness.singleRef.current!(rootElement, 4);
    });

    expect(harness.splitRequests).toHaveLength(1);
    const req = harness.splitRequests[0];
    expect(req.path).toBe(ROOT_FILE);
    expect(req.splitTime).toBe(4);
    expect(req.elementStart).toBe(0);
    expect(req.elementDuration).toBe(10);
  });

  it("rebases each element individually in a mixed razor-split-all gesture", async () => {
    usePlayerStore.setState({ elements: [rootElement, expandedChild] });

    // Master split time T = 3 lies inside both clips.
    await act(async () => {
      await harness.allRef.current!(3);
    });

    expect(harness.splitRequests).toHaveLength(2);
    const rootReq = harness.splitRequests.find((r) => r.path === ROOT_FILE)!;
    const childReq = harness.splitRequests.find((r) => r.path === SUBCOMP_FILE)!;

    // Root clip: already local — master coordinates pass through untouched.
    expect(rootReq.splitTime).toBe(3);
    expect(rootReq.elementStart).toBe(0);

    // Expanded child: rebased by its OWN expandedParentStart, not the root's.
    expect(childReq.splitTime).toBe(1); // 3 - 2
    expect(childReq.elementStart).toBe(0); // 2 - 2
  });
});

// ── Bug 1: split must resync the SDK session so undo isn't refused ────────────

const memoryStorage = (): EditHistoryStorageAdapter => {
  const store = new Map<string, string>();
  return {
    load: async (k) => store.get(k) ?? null,
    save: async (k, v) => {
      store.set(k, v);
    },
  } as unknown as EditHistoryStorageAdapter;
};

interface UndoHarness {
  singleRef: { current: SingleSplit | undefined };
  disk: Record<string, string>;
  store: ReturnType<typeof createPersistentEditHistoryStore>;
  forceReloadSdkSession: ReturnType<typeof vi.fn>;
  root: ReturnType<typeof mountProbe>;
}

function mountRazorSplitWithHistory(): UndoHarness {
  const disk: Record<string, string> = {
    [ROOT_FILE]: `<div class="clip" id="root-clip" data-start="0" data-duration="10"></div>`,
  };
  const store = createPersistentEditHistoryStore({
    projectId: "p1",
    storage: memoryStorage(),
    initialState: createEmptyEditHistory(),
    now: () => Date.now(),
    onChange: () => {},
  });
  const forceReloadSdkSession = vi.fn();

  const fetchMock = createSplitFetchMock(disk);
  vi.stubGlobal("fetch", fetchMock);

  const singleRef: { current: SingleSplit | undefined } = { current: undefined };
  function Component() {
    const { handleRazorSplit } = useRazorSplit({
      projectId: "p1",
      activeCompPath: ROOT_FILE,
      showToast: () => {},
      writeProjectFile: async (path, content) => {
        disk[path] = content;
      },
      recordEdit: (input) => store.recordEdit(input),
      domEditSaveTimestampRef: { current: 0 },
      reloadPreview: () => {},
      forceReloadSdkSession,
    });
    singleRef.current = handleRazorSplit;
    return null;
  }
  const root = mountProbe(Component);
  return { singleRef, disk, store, forceReloadSdkSession, root };
}

describe("useRazorSplit — undo integrity after split (Bug 1)", () => {
  let h: UndoHarness;
  beforeEach(() => {
    h = mountRazorSplitWithHistory();
  });
  afterEach(() => {
    act(() => h.root.unmount());
  });

  const readFile = () => ({
    readFile: async (p: string) => h.disk[p],
    writeFile: async (p: string, c: string) => {
      h.disk[p] = c;
    },
  });

  it("resyncs the SDK session after a split (matches every other server-write path)", async () => {
    await act(async () => {
      await h.singleRef.current!(rootElement, 4);
    });
    expect(h.forceReloadSdkSession).toHaveBeenCalledTimes(1);
  });

  it("applies undo after a split without an external-change refusal", async () => {
    await act(async () => {
      await h.singleRef.current!(rootElement, 4);
    });
    const result = await h.store.undo(readFile());
    expect(result.ok).toBe(true);
    expect(result.reason).toBeUndefined();
    // The file is restored to its pre-split bytes.
    expect(h.disk[ROOT_FILE]).not.toContain("<!--split-->");
  });

  it("still trips the guard when the file is edited externally after a split", async () => {
    await act(async () => {
      await h.singleRef.current!(rootElement, 4);
    });
    // Simulate the user editing the file in their own editor after the split.
    h.disk[ROOT_FILE] = `${h.disk[ROOT_FILE]}<!--hand-edit-->`;
    const result = await h.store.undo(readFile());
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("content-mismatch");
  });
});
