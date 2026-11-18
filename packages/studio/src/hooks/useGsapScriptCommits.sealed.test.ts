// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";

const { previewRequest, patchRuntimeTweenInPlace } = vi.hoisted(() => ({
  previewRequest: vi.fn(),
  patchRuntimeTweenInPlace: vi.fn(),
}));
vi.mock("../player/lib/previewChannel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../player/lib/previewChannel")>()),
  previewFrameOpaque: () => true,
  previewRequest,
}));
vi.mock("./gsapRuntimePatch", () => ({ patchRuntimeTweenInPlace }));

import { applyPreviewSync } from "./useGsapScriptCommits";

const iframe = document.createElement("iframe");
const result = { ok: true, scriptText: "tl.set('#a',{})" };

beforeEach(() => {
  previewRequest.mockReset();
  patchRuntimeTweenInPlace.mockReset();
});

it("sends a sealed preview's value edits to the frame in one request, without empty channels", () => {
  previewRequest.mockResolvedValue({ patched: true });

  applyPreviewSync(
    iframe,
    result,
    {
      label: "drag",
      softReload: true,
      instantPatches: [
        { selector: "#a", change: { kind: "set", props: { x: 10, y: undefined } } },
        { selector: "#b", change: { kind: "global-set", props: { rotation: 45 } } },
      ],
    },
    vi.fn(),
  );

  expect(previewRequest).toHaveBeenCalledExactlyOnceWith(iframe, "patch-tweens", {
    patches: [
      { selector: "#a", change: { kind: "set", props: { x: 10 } } },
      { selector: "#b", change: { kind: "global-set", props: { rotation: 45 } } },
    ],
    seek: true,
  });
  const sent = previewRequest.mock.calls[0]?.[2] as {
    patches: Array<{ change: { props: object } }>;
  };
  expect(Object.keys(sent.patches[0]!.change.props)).toEqual(["x"]);
  expect(patchRuntimeTweenInPlace).not.toHaveBeenCalled();
});

it("keeps the preview when the frame patched every tween, and reloads it when it could not", async () => {
  const instantPatch = { selector: "#a", change: { kind: "set" as const, props: { x: 10 } } };
  const kept = vi.fn();
  previewRequest.mockResolvedValueOnce({ patched: true });
  applyPreviewSync(iframe, result, { label: "drag", instantPatch }, kept);

  const reloaded = vi.fn();
  previewRequest.mockResolvedValueOnce({ patched: false });
  applyPreviewSync(iframe, result, { label: "drag", instantPatch }, reloaded);

  await vi.waitFor(() => expect(reloaded).toHaveBeenCalledOnce());
  expect(kept).not.toHaveBeenCalled();
});

it("reloads a group once, after its last write, when the frame refused an earlier member", async () => {
  const member = (selector: string) => ({
    selector,
    change: { kind: "set" as const, props: { x: 1 } },
  });
  const reloadPreview = vi.fn();
  previewRequest.mockResolvedValueOnce({ patched: false }).mockResolvedValueOnce({ patched: true });

  applyPreviewSync(
    iframe,
    result,
    { label: "move", deferPreviewSync: true, instantPatch: member("#a") },
    reloadPreview,
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(reloadPreview).not.toHaveBeenCalled();

  applyPreviewSync(iframe, result, { label: "move", instantPatch: member("#b") }, reloadPreview);

  await vi.waitFor(() => expect(reloadPreview).toHaveBeenCalledOnce());
});

it("leaves the render to the group's last write", () => {
  previewRequest.mockResolvedValue({ patched: true });

  applyPreviewSync(
    iframe,
    result,
    {
      label: "drag",
      deferPreviewSync: true,
      instantPatch: { selector: "#a", change: { kind: "set", props: { x: 1 } } },
    },
    vi.fn(),
  );

  expect(previewRequest.mock.calls[0]?.[2]).toMatchObject({ seek: false });
});
