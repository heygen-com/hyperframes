import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./bridge", () => ({ postRuntimeMessage: vi.fn() }));

import { postRuntimeMessage } from "./bridge";
import { copiesReady, noteCopy, setCopyReportingLevel } from "./previewCopies";

const posted = vi.mocked(postRuntimeMessage);
const video = () => document.body.appendChild(document.createElement("video"));

afterEach(() => {
  setCopyReportingLevel(1);
  document.body.innerHTML = "";
  posted.mockClear();
});

describe("copy reporting", () => {
  it("counts the copy a file cannot play without at Full quality, and ignores a lighter one", () => {
    setCopyReportingLevel(1);
    posted.mockClear();
    noteCopy(video(), "making", 0.5, true);
    expect(posted).not.toHaveBeenCalled();

    noteCopy(video(), "making", 0.5, false);
    expect(posted).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "preview-copies",
        copies: expect.objectContaining({ total: 1, ready: 0, progress: 0.5 }),
      }),
    );
  });

  it("keeps the unplayable file's copy when the level changes, and leaves lighter readiness alone", () => {
    setCopyReportingLevel(1);
    noteCopy(video(), "making", null, false);
    expect(copiesReady()).toBe(true);

    setCopyReportingLevel(0.5);
    noteCopy(video(), "making", null, true);
    expect(copiesReady()).toBe(false);
    setCopyReportingLevel(1);
    expect(copiesReady()).toBe(true);
    expect(posted).toHaveBeenLastCalledWith(
      expect.objectContaining({ copies: expect.objectContaining({ total: 1 }) }),
    );
  });
});
