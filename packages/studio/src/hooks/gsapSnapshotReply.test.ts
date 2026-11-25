import { describe, expect, it } from "vitest";
import { MAX_SNAPSHOT_FIELDS } from "@hyperframes/core/runtime/editing-port";
import { readGsapSnapshot } from "./gsapSnapshotReply";

const HANDLE = "0000000000000000:1";
const reply = (listLength: number) => ({
  time: 0,
  defaultEase: null,
  timelines: [],
  globalTweens: [
    {
      targets: [HANDLE],
      vars: { a: Array.from({ length: listLength }, () => 1) },
      start: 0,
      duration: 1,
      from: false,
      initted: true,
      parsed: [],
      parts: [],
    },
  ],
  targets: [{ handle: HANDLE, id: "box", className: "", values: { a: 1 } }],
});

describe("readGsapSnapshot", () => {
  it("charges each target to the field bound the frame keeps to", () => {
    expect(readGsapSnapshot(reply(MAX_SNAPSHOT_FIELDS - 20))).not.toBeNull();
    // The vars alone are 3 fields under the bound; the target's handle and fields pass it.
    expect(readGsapSnapshot(reply(MAX_SNAPSHOT_FIELDS - 5))).toBeNull();
  });
});
