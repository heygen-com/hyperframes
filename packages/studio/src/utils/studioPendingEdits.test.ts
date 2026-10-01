// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  addStudioPendingEditFlushListener,
  flushStudioPendingEdits,
  hasStudioPendingEdits,
  trackStudioPendingEdit,
  trackedStudioEdit,
} from "./studioPendingEdits";
import { StudioFileConflictError } from "./studioSaveDiagnostics";

describe("studio pending edit flush", () => {
  it("waits for mounted panels to persist pending local edits", async () => {
    const persist = vi.fn(async () => undefined);
    const remove = addStudioPendingEditFlushListener(persist);

    try {
      await expect(flushStudioPendingEdits()).resolves.toEqual({ status: "clean" });
      expect(persist).toHaveBeenCalledTimes(1);
    } finally {
      remove();
    }
  });

  it("commits the focused debounced field before draining pending work", async () => {
    const input = document.createElement("textarea");
    document.body.append(input);
    const persist = vi.fn(async () => undefined);
    input.addEventListener("blur", () => {
      trackStudioPendingEdit(persist());
    });
    input.focus();

    await expect(flushStudioPendingEdits()).resolves.toEqual({ status: "clean" });

    expect(document.activeElement).not.toBe(input);
    expect(persist).toHaveBeenCalledOnce();
    input.remove();
  });

  it("waits for a post-blur effect to register its pending edit listener", async () => {
    const input = document.createElement("textarea");
    document.body.append(input);
    const persist = vi.fn(async () => undefined);
    let removeListener: (() => void) | undefined;
    let registrationDone: Promise<void> | undefined;
    input.addEventListener("blur", () => {
      registrationDone = new Promise<void>((resolve) => {
        setTimeout(() => {
          removeListener = addStudioPendingEditFlushListener(persist);
          resolve();
        }, 0);
      });
    });
    input.focus();

    try {
      await expect(flushStudioPendingEdits()).resolves.toEqual({ status: "clean" });

      expect(persist).toHaveBeenCalledOnce();
    } finally {
      await registrationDone;
      removeListener?.();
      input.remove();
    }
  });

  it("preserves a pending edit failure instead of reporting a clean drain", async () => {
    const failure = new Error("field save failed");
    const remove = addStudioPendingEditFlushListener(async () => {
      throw failure;
    });

    try {
      await expect(flushStudioPendingEdits()).resolves.toEqual({
        status: "failed",
        error: failure,
      });
    } finally {
      remove();
    }
  });

  it("keeps the full typed conflict payload for the external-change decision", async () => {
    const conflict = new StudioFileConflictError({
      filePath: "index.html",
      currentVersion: "v2",
      currentContent: "external",
      attemptedContent: "studio",
    });
    const remove = addStudioPendingEditFlushListener(async () => {
      throw conflict;
    });

    try {
      await expect(flushStudioPendingEdits()).resolves.toEqual({
        status: "conflict",
        error: conflict,
      });
    } finally {
      remove();
    }
  });

  it("prioritizes a conflict when pending edits fail with mixed errors", async () => {
    const failure = new Error("field save failed");
    const conflict = new StudioFileConflictError({
      filePath: "index.html",
      currentVersion: "v2",
      currentContent: "external",
      attemptedContent: "studio",
    });
    const removeFailure = addStudioPendingEditFlushListener(async () => {
      throw failure;
    });
    const removeConflict = addStudioPendingEditFlushListener(async () => {
      throw conflict;
    });

    try {
      await expect(flushStudioPendingEdits()).resolves.toEqual({
        status: "conflict",
        error: conflict,
      });
    } finally {
      removeFailure();
      removeConflict();
    }
  });

  it("waits for edits already started by unmounted panels", async () => {
    const steps: string[] = [];
    let resolvePersist!: () => void;
    trackStudioPendingEdit(
      new Promise<void>((resolve) => {
        resolvePersist = resolve;
      }).then(() => {
        steps.push("persisted");
      }),
    );

    const flushed = flushStudioPendingEdits().then(() => {
      steps.push("flushed");
    });
    await Promise.resolve();
    expect(steps).toEqual([]);

    resolvePersist();
    await flushed;
    expect(steps).toEqual(["persisted", "flushed"]);
  });
});

describe("a drain that meets a conflict", () => {
  it("still waits for the edits that started while it ran before it reports the conflict", async () => {
    const conflict = new StudioFileConflictError({
      filePath: "index.html",
      currentVersion: "v2",
      currentContent: "external",
      attemptedContent: "studio",
    });
    let finish!: () => void;
    let laterSaved = false;
    trackStudioPendingEdit(
      Promise.resolve().then(() => {
        trackStudioPendingEdit(
          new Promise<void>((resolve) => (finish = resolve)).then(() => (laterSaved = true)),
        );
        throw conflict;
      }),
    );
    let drained = false;
    const drain = flushStudioPendingEdits().then((result) => ((drained = true), result));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(drained).toBe(false);
    finish();
    await expect(drain).resolves.toEqual({ status: "conflict", error: conflict });
    expect(laterSaved).toBe(true);
  });
});

describe("trackedStudioEdit", () => {
  it("counts each call as a pending edit until it settles, and reports a failure to the drain", async () => {
    let fail!: () => void;
    const failure = new Error("The save failed.");
    const edit = trackedStudioEdit(
      () => new Promise<void>((_, reject) => (fail = () => reject(failure))),
    );
    const saved = edit();
    expect(hasStudioPendingEdits()).toBe(true);
    const drain = flushStudioPendingEdits();
    fail();
    await expect(saved).rejects.toThrow("The save failed.");
    await expect(drain).resolves.toEqual({ status: "failed", error: failure });
    expect(hasStudioPendingEdits()).toBe(false);
  });
});
