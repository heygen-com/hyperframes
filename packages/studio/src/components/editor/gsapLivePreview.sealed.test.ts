// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";

const { previewRequest } = vi.hoisted(() => ({
  previewRequest: vi.fn(async () => ({ applied: true })),
}));
vi.mock("../../player/lib/previewChannel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../player/lib/previewChannel")>()),
  previewFrameOpaque: () => true,
  previewRequest,
}));

import { createGsapLivePreview } from "./gsapLivePreview";
import type { DomEditSelection } from "./domEditingTypes";

it("sends a sealed preview's dragged values to the frame through the editing port", () => {
  const iframe = document.createElement("iframe");
  const preview = createGsapLivePreview({ current: iframe });

  preview({ handle: "0123456789abcdef:7" } as DomEditSelection, { rotationY: 30 });

  expect(previewRequest).toHaveBeenCalledExactlyOnceWith(iframe, "gsap-set", {
    handle: "0123456789abcdef:7",
    props: { rotationY: 30 },
  });
});

it("sends nothing for a sealed selection the frame never named", () => {
  previewRequest.mockClear();
  const preview = createGsapLivePreview({ current: document.createElement("iframe") });

  preview({ id: "card" } as DomEditSelection, { x: 10 });

  expect(previewRequest).not.toHaveBeenCalled();
});
