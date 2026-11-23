// @vitest-environment happy-dom

import { StrictMode, act } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  enqueueTimelineEdit,
  refuseWithEarlier,
  useTimelineEditQueue,
  whileShown,
  type TimelineEditQueue,
} from "./timelineEditQueue";
import { installReactActEnvironment, mountReactHarness } from "./domSelectionTestHarness";

installReactActEnvironment();

function deferred() {
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<void>((_, fail) => (reject = fail));
  return { promise, reject };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe("enqueueTimelineEdit", () => {
  // fails without the fix: A's failure cleared the tracking of B's save still in flight.
  it("refuses a ripple queued during a save that then fails, after an earlier save already failed", async () => {
    const queue: TimelineEditQueue = { current: Promise.resolve(), projectId: "project" };
    const a = deferred();
    const b = deferred();
    const writes: string[] = [];
    const first = enqueueTimelineEdit(queue, () => a.promise);
    const second = enqueueTimelineEdit(queue, () => b.promise);
    a.reject(new Error("A refused"));
    await expect(first).rejects.toThrow("A refused");
    await settle();

    const ripple = enqueueTimelineEdit(queue, async () => void writes.push("ripple"), {
      ifEarlierRefused: refuseWithEarlier,
    });
    b.reject(new Error("B refused"));

    await expect(second).rejects.toThrow("B refused");
    await expect(ripple).rejects.toThrow("refused");
    expect(writes).toEqual([]);
  });
});

describe("useTimelineEditQueue", () => {
  // fails without the fix: StrictMode's mount, cleanup and remount left the shown project's queue closed.
  it("keeps the shown project's queue open under StrictMode, so its live steps run", () => {
    let queue: TimelineEditQueue | null = null;
    function Harness({ projectId }: { projectId: string }) {
      queue = useTimelineEditQueue(projectId);
      return null;
    }
    const root = mountReactHarness(
      <StrictMode>
        <Harness projectId="A" />
      </StrictMode>,
    );
    const liveStep = vi.fn();

    whileShown(queue!, liveStep);

    expect(liveStep).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });

  // fails without the fix: back in A, A's next edit ran beside A's held save, which then wrote over it.
  it("keeps one order across a switch away and back, so a held save is never written over", async () => {
    const files: Record<string, string> = { A: "" };
    let queue: TimelineEditQueue | null = null;
    function Harness({ projectId }: { projectId: string }) {
      queue = useTimelineEditQueue(projectId);
      return null;
    }
    const root = mountReactHarness(<Harness projectId="A" />);
    let release: () => void = () => {};
    const held = new Promise<void>((done) => (release = done));
    const first = enqueueTimelineEdit(queue!, async (pid) => {
      const before = files[pid];
      await held;
      files[pid] = `${before}1`;
    });
    act(() => root.render(<Harness projectId="B" />));
    act(() => root.render(<Harness projectId="A" />));
    const second = enqueueTimelineEdit(queue!, async (pid) => {
      files[pid] = `${files[pid]}2`;
    });

    release();
    await Promise.all([first, second]);

    expect(files.A).toBe("12");
    act(() => root.unmount());
  });

  // fails without the fix: the old project's refused delete refused the new project's ripple.
  it("gives a new project its own queue, so a refusal in the old one never touches it", async () => {
    let queue: TimelineEditQueue | null = null;
    function Harness({ projectId }: { projectId: string }) {
      queue = useTimelineEditQueue(projectId);
      return null;
    }
    const root = mountReactHarness(<Harness projectId="old" />);
    const oldSave = deferred();
    const refused = enqueueTimelineEdit(queue!, () => oldSave.promise);
    act(() => root.render(<Harness projectId="new" />));
    const writes: string[] = [];

    const ripple = enqueueTimelineEdit(queue!, async () => void writes.push("ripple"), {
      ifEarlierRefused: refuseWithEarlier,
    });
    oldSave.reject(new Error("refused"));

    await expect(refused).rejects.toThrow("refused");
    await expect(ripple).resolves.toBeUndefined();
    expect(writes).toEqual(["ripple"]);
    act(() => root.unmount());
  });
});
