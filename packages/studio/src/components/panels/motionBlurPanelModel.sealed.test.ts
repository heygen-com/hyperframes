// @vitest-environment happy-dom
import { MOTION_BLUR_ATTR } from "@hyperframes/core/motion-blur-settings";
import { expect, it, vi } from "vitest";

const SHUTTER = Object.values(MOTION_BLUR_ATTR)[0]!;

vi.mock("../../player/lib/previewChannel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../player/lib/previewChannel")>()),
  previewFrameOpaque: () => true,
}));
vi.mock("../../player/lib/previewElements", () => ({
  queryPreviewElements: vi.fn(async () => ({ matches: [{ handle: "0123456789abcdef:1" }] })),
  describePreviewElements: vi.fn(async () => [
    {
      attributes: [
        ["data-composition-id", "main"],
        [SHUTTER, "0.5"],
      ],
    },
  ]),
}));

import { readPreviewRootAttributes } from "./motionBlurPanelModel";

it("reads a sealed preview's root blur settings through the editing port, and only those", async () => {
  const iframe = document.createElement("iframe");

  expect(readPreviewRootAttributes(iframe)).toBeNull();
  await vi.waitFor(() => expect(readPreviewRootAttributes(iframe)).toEqual({ [SHUTTER]: "0.5" }));
});
