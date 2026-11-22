// @vitest-environment happy-dom

import { act } from "react";
import { describe, expect, it } from "vitest";
import {
  enqueueTimelineEdit,
  refuseWithEarlier,
  useTimelineEditQueue,
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
    const queue: TimelineEditQueue = { current: Promise.resolve() };
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
