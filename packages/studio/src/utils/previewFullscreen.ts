import { isEditableTarget } from "./timelineDiscovery";

export type PreviewFullscreenHotkeyEvent = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey" | "target"
>;

export function shouldHandlePreviewFullscreenHotkey(event: PreviewFullscreenHotkeyEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
  if (event.key.toLowerCase() !== "f") return false;
  return !isEditableTarget(event.target);
}

export async function toggleElementFullscreen(
  element: HTMLElement,
  doc: Document = document,
): Promise<"entered" | "exited"> {
  if (doc.fullscreenElement) {
    await doc.exitFullscreen();
    return "exited";
  }

  await element.requestFullscreen();
  return "entered";
}
