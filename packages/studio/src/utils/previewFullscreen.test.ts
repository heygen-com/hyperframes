import { describe, expect, it, vi } from "vitest";
import {
  type PreviewFullscreenHotkeyEvent,
  shouldHandlePreviewFullscreenHotkey,
  toggleElementFullscreen,
} from "./previewFullscreen";

describe("preview fullscreen helpers", () => {
  function event(
    overrides: Partial<PreviewFullscreenHotkeyEvent> = {},
  ): PreviewFullscreenHotkeyEvent {
    return {
      key: "f",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      target: null,
      ...overrides,
    };
  }

  it("handles plain F outside editable controls", () => {
    expect(shouldHandlePreviewFullscreenHotkey(event())).toBe(true);
  });

  it("ignores modified shortcuts and editable targets", () => {
    const editableTarget = {
      closest: () => ({}),
    } as unknown as EventTarget;

    expect(shouldHandlePreviewFullscreenHotkey(event({ ctrlKey: true }))).toBe(false);
    expect(shouldHandlePreviewFullscreenHotkey(event({ shiftKey: true }))).toBe(false);
    expect(shouldHandlePreviewFullscreenHotkey(event({ key: "g" }))).toBe(false);
    expect(shouldHandlePreviewFullscreenHotkey(event({ target: editableTarget }))).toBe(false);
  });

  it("enters fullscreen when no element is fullscreen", async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const element = { requestFullscreen } as unknown as HTMLElement;
    const doc = { fullscreenElement: null } as unknown as Document;

    const result = await toggleElementFullscreen(element, doc);

    expect(result).toBe("entered");
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
  });

  it("exits fullscreen when a fullscreen element already exists", async () => {
    const element = {} as HTMLElement;
    const exitFullscreen = vi.fn().mockResolvedValue(undefined);
    const doc = { fullscreenElement: element, exitFullscreen } as unknown as Document;
    const result = await toggleElementFullscreen(element, doc);

    expect(result).toBe("exited");
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
  });
});
