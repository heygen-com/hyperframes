import { describe, expect, it } from "vitest";
import { getPreviewPlayerKey } from "./NLEPreview";

describe("getPreviewPlayerKey", () => {
  it("keeps the same player identity when only refreshKey changes", () => {
    expect(
      getPreviewPlayerKey({
        projectId: "timeline-edit-playground",
        refreshKey: 1,
      }),
    ).toBe(
      getPreviewPlayerKey({
        projectId: "timeline-edit-playground",
        refreshKey: 2,
      }),
    );
  });

  it("switches identity when drilling into a different directUrl", () => {
    expect(
      getPreviewPlayerKey({
        projectId: "timeline-edit-playground",
        directUrl: "/api/projects/timeline-edit-playground/preview",
      }),
    ).not.toBe(
      getPreviewPlayerKey({
        projectId: "timeline-edit-playground",
        directUrl: "/api/projects/timeline-edit-playground/preview/comp/compositions/intro.html",
      }),
    );
  });
});
