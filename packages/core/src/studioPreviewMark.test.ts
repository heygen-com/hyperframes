import { describe, expect, it } from "vitest";
import { refusedPreviewMessage, refusedPreviewStatus } from "./studioPreviewMark";

describe("refusedPreviewStatus", () => {
  it.each([404, 410, 500])("reads %i back out of the refused page's message", (status) => {
    expect(refusedPreviewStatus(refusedPreviewMessage(status))).toBe(status);
  });

  it.each([
    "Composition timeline not found after 8s",
    "it took too long to load",
    "x The preview page could not be loaded (HTTP 404).",
  ])("finds no status in %j", (cause) => {
    expect(refusedPreviewStatus(cause)).toBeNull();
  });
});
