import { describe, expect, it, vi } from "vitest";
import {
  shouldUseSdkCutover,
  sdkCutoverPersist,
  sdkDeletePersist,
  sdkTimingPersist,
  sdkGsapTweenPersist,
  sdkGsapKeyframePersist,
} from "./sdkCutover";
import { openComposition } from "@hyperframes/sdk";
import { createMemoryAdapter } from "@hyperframes/sdk/adapters/memory";
import type { PatchOperation } from "./sourcePatcher";
import type { MutableRefObject } from "react";

vi.mock("../components/editor/manualEditingAvailability", () => ({
  STUDIO_SDK_CUTOVER_ENABLED: true,
  STUDIO_SDK_RESOLVER_SHADOW_ENABLED: false,
}));
vi.mock("./studioTelemetry", () => ({
  trackStudioEvent: vi.fn(),
}));

const styleOp = (property: string, value: string): PatchOperation => ({
  type: "inline-style",
  property,
  value,
});

const textOp = (value: string): PatchOperation => ({
  type: "text-content",
  property: "text",
  value,
});

const attrOp = (property: string, value: string): PatchOperation => ({
  type: "attribute",
  property,
  value,
});

const htmlAttrOp = (property: string, value: string): PatchOperation => ({
  type: "html-attribute",
  property,
  value,
});

describe("shouldUseSdkCutover", () => {
  it("returns false when flag disabled", () => {
    expect(shouldUseSdkCutover(false, true, "hf-abc", [styleOp("color", "red")])).toBe(false);
  });

  it("returns false when no session", () => {
    expect(shouldUseSdkCutover(true, false, "hf-abc", [styleOp("color", "red")])).toBe(false);
  });

  it("returns false when no hfId", () => {
    expect(shouldUseSdkCutover(true, true, null, [styleOp("color", "red")])).toBe(false);
    expect(shouldUseSdkCutover(true, true, undefined, [styleOp("color", "red")])).toBe(false);
  });

  it("returns false when ops empty", () => {
    expect(shouldUseSdkCutover(true, true, "hf-abc", [])).toBe(false);
  });

  it("returns true for inline-style ops", () => {
    expect(shouldUseSdkCutover(true, true, "hf-abc", [styleOp("color", "red")])).toBe(true);
  });

  it("returns true for text-content ops", () => {
    expect(shouldUseSdkCutover(true, true, "hf-abc", [textOp("hello")])).toBe(true);
  });

  it("returns true for attribute ops", () => {
    expect(shouldUseSdkCutover(true, true, "hf-abc", [attrOp("data-x", "10")])).toBe(true);
  });

  it("returns true for html-attribute ops", () => {
    expect(shouldUseSdkCutover(true, true, "hf-abc", [htmlAttrOp("class", "foo")])).toBe(true);
  });

  it("returns false for an attribute op that maps to a reserved data-* name", () => {
    // {type:'attribute', property:'end'} → 'data-end', which the SDK's
    // validateSetAttribute rejects. Decline the batch so it takes the server
    // path cleanly instead of throwing inside dispatch and falling back per op.
    expect(shouldUseSdkCutover(true, true, "hf-abc", [attrOp("end", "2")])).toBe(false);
    expect(shouldUseSdkCutover(true, true, "hf-abc", [attrOp("data-start", "1")])).toBe(false);
  });

  it("declines a case-variant reserved attribute (SDK lowercases before checking)", () => {
    // attribute op "END" → "data-END" → lower → "data-end" (reserved).
    expect(shouldUseSdkCutover(true, true, "hf-abc", [attrOp("END", "2")])).toBe(false);
  });

  it("declines an html-attribute op whose raw name is reserved", () => {
    // html-attribute ops aren't data-prefixed, so a raw reserved name must still
    // be caught (the SDK throws on it just the same).
    expect(shouldUseSdkCutover(true, true, "hf-abc", [htmlAttrOp("data-end", "3")])).toBe(false);
    expect(shouldUseSdkCutover(true, true, "hf-abc", [htmlAttrOp("DATA-START", "1")])).toBe(false);
  });

  it("returns true when ops mix all supported types", () => {
    expect(
      shouldUseSdkCutover(true, true, "hf-abc", [
        styleOp("color", "red"),
        textOp("hello"),
        attrOp("x", "1"),
        htmlAttrOp("class", "foo"),
      ]),
    ).toBe(true);
  });
});

describe("sdkCutoverPersist", () => {
  const makeRef = <T>(val: T): MutableRefObject<T> => ({ current: val });

  const makeDeps = (overrides: Partial<Parameters<typeof sdkCutoverPersist>[5]> = {}) => ({
    editHistory: { recordEdit: vi.fn().mockResolvedValue(undefined) },
    writeProjectFile: vi.fn().mockResolvedValue(undefined),
    reloadPreview: vi.fn(),
    domEditSaveTimestampRef: makeRef(0),
    ...overrides,
  });

  const makeSession = (hasEl = true) =>
    ({
      getElement: vi.fn().mockReturnValue(hasEl ? { inlineStyles: {} } : null),
      dispatch: vi.fn(),
      // Distinct before/after so the no-op guard (after === before → fall back)
      // treats this as a real change; "after" matches the write assertions.
      serialize: vi
        .fn()
        .mockReturnValueOnce("<html>before</html>")
        .mockReturnValue("<html></html>"),
      batch: vi.fn((fn: () => void) => fn()),
    }) as unknown as Parameters<typeof sdkCutoverPersist>[4];

  it("returns false when session is null", async () => {
    const deps = makeDeps();
    const sel = { hfId: "hf-abc" } as never;
    const result = await sdkCutoverPersist(
      sel,
      [styleOp("color", "red")],
      "before",
      "/path.html",
      null,
      deps,
    );
    expect(result).toBe(false);
  });

  it("returns false when element not found in session", async () => {
    const deps = makeDeps();
    const session = makeSession(false);
    const sel = { hfId: "hf-abc" } as never;
    const result = await sdkCutoverPersist(
      sel,
      [styleOp("color", "red")],
      "before",
      "/path.html",
      session,
      deps,
    );
    expect(result).toBe(false);
  });

  it("dispatches setStyle for inline-style ops", async () => {
    const deps = makeDeps();
    const session = makeSession(true);
    const sel = { hfId: "hf-abc" } as never;
    const result = await sdkCutoverPersist(
      sel,
      [styleOp("color", "red"), styleOp("opacity", "0.5")],
      "before",
      "/comp.html",
      session,
      deps,
    );
    expect(result).toBe(true);
    expect(session!.dispatch).toHaveBeenCalledWith({
      type: "setStyle",
      target: "hf-abc",
      styles: { color: "red", opacity: "0.5" },
    });
    expect(deps.writeProjectFile).toHaveBeenCalledWith("/comp.html", "<html></html>");
    expect(deps.reloadPreview).toHaveBeenCalled();
  });

  it("dispatches setText for text-content op", async () => {
    const deps = makeDeps();
    const session = makeSession(true);
    const sel = { hfId: "hf-abc" } as never;
    const result = await sdkCutoverPersist(
      sel,
      [textOp("Hello world")],
      "before",
      "/comp.html",
      session,
      deps,
    );
    expect(result).toBe(true);
    expect(session!.dispatch).toHaveBeenCalledWith({
      type: "setText",
      target: "hf-abc",
      value: "Hello world",
    });
  });

  it("dispatches setAttribute for attribute op with data- prefix", async () => {
    const deps = makeDeps();
    const session = makeSession(true);
    const sel = { hfId: "hf-abc" } as never;
    const result = await sdkCutoverPersist(
      sel,
      [attrOp("x", "42")],
      "before",
      "/comp.html",
      session,
      deps,
    );
    expect(result).toBe(true);
    expect(session!.dispatch).toHaveBeenCalledWith({
      type: "setAttribute",
      target: "hf-abc",
      name: "data-x",
      value: "42",
    });
  });

  it("dispatches setAttribute for html-attribute op", async () => {
    const deps = makeDeps();
    const session = makeSession(true);
    const sel = { hfId: "hf-abc" } as never;
    const result = await sdkCutoverPersist(
      sel,
      [htmlAttrOp("class", "foo bar")],
      "before",
      "/comp.html",
      session,
      deps,
    );
    expect(result).toBe(true);
    expect(session!.dispatch).toHaveBeenCalledWith({
      type: "setAttribute",
      target: "hf-abc",
      name: "class",
      value: "foo bar",
    });
  });

  it("passes caller label to recordEdit", async () => {
    const deps = makeDeps();
    const session = makeSession(true);
    const sel = { hfId: "hf-abc" } as never;
    await sdkCutoverPersist(sel, [styleOp("color", "red")], "before", "/comp.html", session, deps, {
      label: "Resize layer box",
    });
    expect(deps.editHistory.recordEdit).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Resize layer box" }),
    );
  });

  it("passes caller coalesceKey to recordEdit", async () => {
    const deps = makeDeps();
    const session = makeSession(true);
    const sel = { hfId: "hf-abc" } as never;
    await sdkCutoverPersist(sel, [styleOp("color", "red")], "before", "/comp.html", session, deps, {
      coalesceKey: "my-key",
    });
    expect(deps.editHistory.recordEdit).toHaveBeenCalledWith(
      expect.objectContaining({ coalesceKey: "my-key" }),
    );
  });

  it("returns false and does not throw on dispatch error", async () => {
    const deps = makeDeps();
    const session = makeSession(true);
    (session!.dispatch as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("dispatch failed");
    });
    const sel = { hfId: "hf-abc" } as never;
    const result = await sdkCutoverPersist(
      sel,
      [styleOp("color", "red")],
      "before",
      "/comp.html",
      session,
      deps,
    );
    expect(result).toBe(false);
    expect(deps.reloadPreview).not.toHaveBeenCalled();
  });

  it("wraps all dispatches in session.batch() for atomic rollback", async () => {
    const deps = makeDeps();
    const session = makeSession(true);
    const sel = { hfId: "hf-abc" } as never;
    await sdkCutoverPersist(
      sel,
      [styleOp("color", "red"), styleOp("opacity", "0.5")],
      "before",
      "/comp.html",
      session,
      deps,
    );
    expect(
      (session as unknown as { batch: ReturnType<typeof vi.fn> }).batch,
    ).toHaveBeenCalledOnce();
  });

  it("returns false when second dispatch throws (batch prevents partial mutation)", async () => {
    // inline-style ops coalesce into one setStyle dispatch; use style+text to produce two dispatches.
    const deps = makeDeps();
    const session = makeSession(true);
    let callCount = 0;
    (session!.dispatch as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      if (callCount === 2) throw new Error("2nd op failed");
    });
    const sel = { hfId: "hf-abc" } as never;
    const result = await sdkCutoverPersist(
      sel,
      [styleOp("color", "red"), textOp("hello")],
      "before",
      "/comp.html",
      session,
      deps,
    );
    expect(result).toBe(false);
    expect(deps.writeProjectFile).not.toHaveBeenCalled();
    expect(deps.reloadPreview).not.toHaveBeenCalled();
  });
});

describe("sdkDeletePersist", () => {
  const makeRef = <T>(val: T): MutableRefObject<T> => ({ current: val });
  const makeDeps = () => ({
    editHistory: { recordEdit: vi.fn().mockResolvedValue(undefined) },
    writeProjectFile: vi.fn().mockResolvedValue(undefined),
    reloadPreview: vi.fn(),
    domEditSaveTimestampRef: makeRef(0),
  });

  const makeSession = (hasEl = true) =>
    ({
      getElement: vi.fn().mockReturnValue(hasEl ? { id: "hf-abc" } : null),
      removeElement: vi.fn(),
      serialize: vi
        .fn()
        .mockReturnValueOnce("<html>before-snap</html>")
        .mockReturnValue("<html>after</html>"),
      batch: vi.fn((fn: () => void) => fn()),
    }) as unknown as Parameters<typeof sdkDeletePersist>[3];

  it("returns false when session is null", async () => {
    expect(await sdkDeletePersist("hf-abc", "before", "/comp.html", null, makeDeps())).toBe(false);
  });

  it("returns false when element not found in session", async () => {
    const session = makeSession(false);
    expect(await sdkDeletePersist("hf-abc", "before", "/comp.html", session, makeDeps())).toBe(
      false,
    );
  });

  it("calls removeElement and writes serialized content", async () => {
    const deps = makeDeps();
    const session = makeSession(true);
    const result = await sdkDeletePersist("hf-abc", "before", "/comp.html", session, deps);
    expect(result).toBe(true);
    expect(session!.removeElement).toHaveBeenCalledWith("hf-abc");
    expect(deps.writeProjectFile).toHaveBeenCalledWith("/comp.html", "<html>after</html>");
  });

  it("records edit history with before/after diff", async () => {
    const deps = makeDeps();
    const session = makeSession(true);
    await sdkDeletePersist("hf-abc", "before-content", "/comp.html", session, deps);
    expect(deps.editHistory.recordEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "Delete element",
        files: { "/comp.html": { before: "before-content", after: "<html>after</html>" } },
      }),
    );
  });

  it("calls reloadPreview on success", async () => {
    const deps = makeDeps();
    const session = makeSession(true);
    await sdkDeletePersist("hf-abc", "before", "/comp.html", session, deps);
    expect(deps.reloadPreview).toHaveBeenCalled();
  });

  it("returns false and does not write on removeElement error", async () => {
    const deps = makeDeps();
    const session = makeSession(true);
    (session!.removeElement as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("remove failed");
    });
    const result = await sdkDeletePersist("hf-abc", "before", "/comp.html", session, deps);
    expect(result).toBe(false);
    expect(deps.writeProjectFile).not.toHaveBeenCalled();
    expect(deps.reloadPreview).not.toHaveBeenCalled();
  });
});

describe("sdkTimingPersist", () => {
  const makeRef = <T>(val: T): MutableRefObject<T> => ({ current: val });
  const makeDeps = () => ({
    editHistory: { recordEdit: vi.fn().mockResolvedValue(undefined) },
    writeProjectFile: vi.fn().mockResolvedValue(undefined),
    reloadPreview: vi.fn(),
    domEditSaveTimestampRef: makeRef(0),
  });

  const makeSession = (hasEl = true) =>
    ({
      getElement: vi.fn().mockReturnValue(hasEl ? { id: "hf-clip" } : null),
      setTiming: vi.fn(),
      serialize: vi
        .fn()
        .mockReturnValueOnce("<html>before</html>")
        .mockReturnValue("<html>after</html>"),
      batch: vi.fn((fn: () => void) => fn()),
    }) as unknown as Parameters<typeof sdkTimingPersist>[3];

  it("returns false when session is null", async () => {
    expect(await sdkTimingPersist("hf-clip", "/comp.html", { start: 1 }, null, makeDeps())).toBe(
      false,
    );
  });

  it("returns false when element not found in session", async () => {
    const session = makeSession(false);
    expect(await sdkTimingPersist("hf-clip", "/comp.html", { start: 1 }, session, makeDeps())).toBe(
      false,
    );
  });

  it("calls setTiming with provided update and writes serialized content", async () => {
    const deps = makeDeps();
    const session = makeSession(true);
    const result = await sdkTimingPersist(
      "hf-clip",
      "/comp.html",
      { start: 2, duration: 5, trackIndex: 1 },
      session,
      deps,
    );
    expect(result).toBe(true);
    expect(session!.setTiming).toHaveBeenCalledWith("hf-clip", {
      start: 2,
      duration: 5,
      trackIndex: 1,
    });
    expect(deps.writeProjectFile).toHaveBeenCalledWith("/comp.html", "<html>after</html>");
  });

  it("captures before-state before setTiming dispatch", async () => {
    const deps = makeDeps();
    const session = makeSession(true);
    await sdkTimingPersist("hf-clip", "/comp.html", { start: 3 }, session, deps);
    expect(deps.editHistory.recordEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        files: { "/comp.html": { before: "<html>before</html>", after: "<html>after</html>" } },
      }),
    );
  });

  it("returns false and does not write on setTiming error", async () => {
    const deps = makeDeps();
    const session = makeSession(true);
    (session!.setTiming as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("timing error");
    });
    const result = await sdkTimingPersist("hf-clip", "/comp.html", { start: 1 }, session, deps);
    expect(result).toBe(false);
    expect(deps.writeProjectFile).not.toHaveBeenCalled();
  });

  // Finding #12: undo baseline must be the EXACT on-disk bytes (matching the
  // style/delete paths), not a normalized SDK serialize() re-emit — otherwise
  // undoing a timing edit reformats the whole file.
  it("records the on-disk content (not serialize()) as the undo before when a reader is provided", async () => {
    const deps = {
      ...makeDeps(),
      readProjectFile: vi.fn().mockResolvedValue("<html>EXACT ON-DISK BYTES</html>"),
    };
    const session = makeSession(true);
    await sdkTimingPersist("hf-clip", "/comp.html", { start: 3 }, session, deps);
    expect(deps.readProjectFile).toHaveBeenCalledWith("/comp.html");
    expect(deps.editHistory.recordEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        files: {
          "/comp.html": { before: "<html>EXACT ON-DISK BYTES</html>", after: "<html>after</html>" },
        },
      }),
    );
  });

  it("falls back to serialize() before when the reader throws", async () => {
    const deps = {
      ...makeDeps(),
      readProjectFile: vi.fn().mockRejectedValue(new Error("read failed")),
    };
    const session = makeSession(true);
    await sdkTimingPersist("hf-clip", "/comp.html", { start: 3 }, session, deps);
    expect(deps.editHistory.recordEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        files: { "/comp.html": { before: "<html>before</html>", after: "<html>after</html>" } },
      }),
    );
  });
});

describe("sdkGsapTweenPersist — undo baseline (finding #12)", () => {
  const makeRef = <T>(val: T): MutableRefObject<T> => ({ current: val });
  const makeSession = () =>
    ({
      getElement: vi.fn().mockReturnValue({ id: "hf-box" }),
      setGsapTween: vi.fn(),
      serialize: vi
        .fn()
        .mockReturnValueOnce("<html>serialized-before</html>")
        .mockReturnValue("<html>after</html>"),
      batch: vi.fn((fn: () => void) => fn()),
    }) as unknown as Parameters<typeof sdkGsapTweenPersist>[2];

  it("records the on-disk content as the undo before, not serialize()", async () => {
    const deps = {
      editHistory: { recordEdit: vi.fn().mockResolvedValue(undefined) },
      writeProjectFile: vi.fn().mockResolvedValue(undefined),
      reloadPreview: vi.fn(),
      domEditSaveTimestampRef: makeRef(0),
      readProjectFile: vi.fn().mockResolvedValue("<html>on-disk gsap bytes</html>"),
    };
    const session = makeSession();
    await sdkGsapTweenPersist(
      "/comp.html",
      { kind: "set", animationId: "tw-1", properties: { ease: "power3.in" } },
      session,
      deps,
    );
    expect(deps.editHistory.recordEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        files: {
          "/comp.html": { before: "<html>on-disk gsap bytes</html>", after: "<html>after</html>" },
        },
      }),
    );
  });
});

describe("sdkGsapTweenPersist — per-file serialization (finding #8)", () => {
  const makeRef = <T>(val: T): MutableRefObject<T> => ({ current: val });

  it("routes the read-modify-write through the keyed serializer so same-file flushes can't interleave", async () => {
    const order: string[] = [];
    let writeResolve: (() => void) | null = null;
    const deps = {
      editHistory: { recordEdit: vi.fn().mockResolvedValue(undefined) },
      // First write blocks until we release it, so without serialization the
      // second op's serialize()/dispatch would interleave ahead of it.
      writeProjectFile: vi.fn().mockImplementation((_p: string, content: string) => {
        order.push(`write-start:${content}`);
        if (content === "<html>after-1</html>") {
          return new Promise<void>((res) => {
            writeResolve = () => {
              order.push(`write-done:${content}`);
              res();
            };
          });
        }
        order.push(`write-done:${content}`);
        return Promise.resolve();
      }),
      reloadPreview: vi.fn(),
      domEditSaveTimestampRef: makeRef(0),
      // A real per-key serializer: tasks under the same key run strictly in order.
      serialize: (() => {
        const inFlight = new Map<string, Promise<unknown>>();
        return <T>(key: string, task: () => Promise<T>): Promise<T> => {
          const prior = inFlight.get(key) ?? Promise.resolve();
          const next = prior.then(task, task);
          inFlight.set(key, next);
          return next as Promise<T>;
        };
      })(),
    };

    let serializeCall = 0;
    const session = {
      getElement: vi.fn().mockReturnValue({ id: "hf-box" }),
      setGsapTween: vi.fn(() => order.push("dispatch")),
      serialize: vi.fn(() => {
        serializeCall++;
        // before-1, after-1, before-2, after-2
        return `<html>${serializeCall % 2 === 1 ? "before" : "after"}-${Math.ceil(serializeCall / 2)}</html>`;
      }),
      batch: vi.fn((fn: () => void) => fn()),
    } as unknown as Parameters<typeof sdkGsapTweenPersist>[2];

    const p1 = sdkGsapTweenPersist(
      "/comp.html",
      { kind: "set", animationId: "tw-1", properties: { ease: "a" } },
      session,
      deps,
    );
    const p2 = sdkGsapTweenPersist(
      "/comp.html",
      { kind: "set", animationId: "tw-1", properties: { ease: "b" } },
      session,
      deps,
    );
    // Let the first op reach its (blocked) write before releasing it.
    await Promise.resolve();
    await Promise.resolve();
    writeResolve?.();
    await Promise.all([p1, p2]);

    // The second op's write must NOT start before the first op's write completes.
    const firstWriteDone = order.indexOf("write-done:<html>after-1</html>");
    const secondWriteStart = order.indexOf("write-start:<html>after-2</html>");
    expect(firstWriteDone).toBeGreaterThanOrEqual(0);
    expect(secondWriteStart).toBeGreaterThan(firstWriteDone);
  });
});

describe("sdkGsapTweenPersist", () => {
  const makeRef = <T>(val: T): MutableRefObject<T> => ({ current: val });
  const makeDeps = () => ({
    editHistory: { recordEdit: vi.fn().mockResolvedValue(undefined) },
    writeProjectFile: vi.fn().mockResolvedValue(undefined),
    reloadPreview: vi.fn(),
    domEditSaveTimestampRef: makeRef(0),
  });

  const makeSession = (opts?: { addGsapTween?: string; hasEl?: boolean }) =>
    ({
      getElement: vi.fn().mockReturnValue(opts?.hasEl !== false ? { id: "hf-box" } : null),
      addGsapTween: vi.fn().mockReturnValue(opts?.addGsapTween ?? "tw-1"),
      setGsapTween: vi.fn(),
      removeGsapTween: vi.fn(),
      serialize: vi
        .fn()
        .mockReturnValueOnce("<html>before</html>")
        .mockReturnValue("<html>after</html>"),
      batch: vi.fn((fn: () => void) => fn()),
    }) as unknown as Parameters<typeof sdkGsapTweenPersist>[2];

  it("returns false when session is null", async () => {
    expect(
      await sdkGsapTweenPersist(
        "/comp.html",
        { kind: "remove", animationId: "tw-1" },
        null,
        makeDeps(),
      ),
    ).toBe(false);
  });

  it("calls addGsapTween and writes for kind=add", async () => {
    const deps = makeDeps();
    const session = makeSession();
    const result = await sdkGsapTweenPersist(
      "/comp.html",
      {
        kind: "add",
        target: "hf-box",
        spec: { method: "to", duration: 1, properties: { opacity: 1 } },
      },
      session,
      deps,
    );
    expect(result).toBe(true);
    expect(session!.addGsapTween).toHaveBeenCalledWith(
      "hf-box",
      expect.objectContaining({ method: "to" }),
    );
    expect(deps.writeProjectFile).toHaveBeenCalledWith("/comp.html", "<html>after</html>");
  });

  it("returns false for kind=add when element not found", async () => {
    const deps = makeDeps();
    const session = makeSession({ hasEl: false });
    const result = await sdkGsapTweenPersist(
      "/comp.html",
      { kind: "add", target: "hf-box", spec: { method: "to", properties: { x: 100 } } },
      session,
      deps,
    );
    expect(result).toBe(false);
    expect(deps.writeProjectFile).not.toHaveBeenCalled();
  });

  it("calls setGsapTween and writes for kind=set", async () => {
    const deps = makeDeps();
    const session = makeSession();
    const result = await sdkGsapTweenPersist(
      "/comp.html",
      { kind: "set", animationId: "tw-1", properties: { ease: "power3.in" } },
      session,
      deps,
    );
    expect(result).toBe(true);
    expect(session!.setGsapTween).toHaveBeenCalledWith("tw-1", { ease: "power3.in" });
    expect(deps.reloadPreview).toHaveBeenCalled();
  });

  it("calls removeGsapTween for kind=remove", async () => {
    const deps = makeDeps();
    const session = makeSession();
    const result = await sdkGsapTweenPersist(
      "/comp.html",
      { kind: "remove", animationId: "tw-1" },
      session,
      deps,
    );
    expect(result).toBe(true);
    expect(session!.removeGsapTween).toHaveBeenCalledWith("tw-1");
  });

  it("returns false and does not write on SDK error", async () => {
    const deps = makeDeps();
    const session = makeSession();
    (session!.removeGsapTween as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("gsap error");
    });
    const result = await sdkGsapTweenPersist(
      "/comp.html",
      { kind: "remove", animationId: "tw-1" },
      session,
      deps,
    );
    expect(result).toBe(false);
    expect(deps.writeProjectFile).not.toHaveBeenCalled();
  });
});

describe("sdkGsapKeyframePersist", () => {
  const makeRef = <T>(val: T): MutableRefObject<T> => ({ current: val });
  const makeDeps = () => ({
    editHistory: { recordEdit: vi.fn().mockResolvedValue(undefined) },
    writeProjectFile: vi.fn().mockResolvedValue(undefined),
    reloadPreview: vi.fn(),
    domEditSaveTimestampRef: makeRef(0),
  });

  const makeSession = () =>
    ({
      dispatch: vi.fn(),
      serialize: vi
        .fn()
        .mockReturnValueOnce("<html>before</html>")
        .mockReturnValue("<html>after</html>"),
      batch: vi.fn((fn: () => void) => fn()),
    }) as unknown as Parameters<typeof sdkGsapKeyframePersist>[4];

  it("returns false when session is null", async () => {
    expect(
      await sdkGsapKeyframePersist("/comp.html", "tw-1", 50, { opacity: 0.5 }, null, makeDeps()),
    ).toBe(false);
  });

  it("dispatches addGsapKeyframe and writes serialized content", async () => {
    const deps = makeDeps();
    const session = makeSession();
    const result = await sdkGsapKeyframePersist(
      "/comp.html",
      "tw-1",
      50,
      { opacity: 0.5 },
      session,
      deps,
    );
    expect(result).toBe(true);
    expect(session!.dispatch).toHaveBeenCalledWith({
      type: "addGsapKeyframe",
      animationId: "tw-1",
      position: 50,
      value: { opacity: 0.5 },
    });
    expect(deps.writeProjectFile).toHaveBeenCalledWith("/comp.html", "<html>after</html>");
    expect(deps.reloadPreview).toHaveBeenCalled();
  });

  it("returns false and does not write on dispatch error", async () => {
    const deps = makeDeps();
    const session = makeSession();
    (session!.dispatch as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("dispatch failed");
    });
    const result = await sdkGsapKeyframePersist(
      "/comp.html",
      "tw-1",
      25,
      { x: 100 },
      session,
      deps,
    );
    expect(result).toBe(false);
    expect(deps.writeProjectFile).not.toHaveBeenCalled();
  });
});

describe("sdkCutoverPersist — GSAP script preservation (integration)", () => {
  const makeRef = <T>(val: T): MutableRefObject<T> => ({ current: val });
  const makeDeps = () => ({
    editHistory: { recordEdit: vi.fn().mockResolvedValue(undefined) },
    writeProjectFile: vi.fn().mockResolvedValue(undefined),
    reloadPreview: vi.fn(),
    domEditSaveTimestampRef: makeRef(0),
  });

  it("preserves GSAP <script> block and data-position-mode through setStyle dispatch", async () => {
    const html = `<!DOCTYPE html><html><head></head><body>
<div data-hf-id="hf-layer" style="color: blue; opacity: 1"></div>
<script data-hf-gsap data-position-mode="relative">
gsap.timeline().to('[data-hf-id="hf-layer"]', { duration: 1, x: 100 });
</script>
</body></html>`;
    const comp = await openComposition(html, { persist: createMemoryAdapter() });
    const deps = makeDeps();
    const sel = { hfId: "hf-layer" } as never;
    const result = await sdkCutoverPersist(
      sel,
      [{ type: "inline-style", property: "color", value: "red" }],
      html,
      "/comp.html",
      comp,
      deps,
    );
    expect(result).toBe(true);
    const written = (deps.writeProjectFile as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[1] as string;
    expect(written).toContain("data-hf-gsap");
    expect(written).toContain('data-position-mode="relative"');
    expect(written).toContain("gsap.timeline()");
  });
});
