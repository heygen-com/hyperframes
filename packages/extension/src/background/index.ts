import { WEB_CAPTURE_BUDGETS, utf8ByteLength } from "@hyperframes/core/web-capture";
import { buildEditableCapture, buildStillCapture, validateCaptureText } from "../capture/envelope";
import { compressOpaqueCrop, cropVisiblePng } from "../capture/png";
import { SerialClipboardWriter } from "../clipboard/queue";
import {
  parseExtensionRequest,
  type EditableDomDraft,
  type ExtensionResponse,
  type SelectionRect,
} from "../protocol";
import type { ChromeMessageSender, ChromeTab } from "../platform/chrome";

const OFFSCREEN_URL = "offscreen.html";
let offscreenCreation: Promise<void> | null = null;

function failure(code: string, message: string): ExtensionResponse {
  return { ok: false, code, message };
}

function supportedUrl(url: string | undefined): url is string {
  return url !== undefined && /^(https?|file):/.test(url);
}

function activeTabIdentity(
  sender: ChromeMessageSender,
): { tabId: number; windowId: number; documentId: string; url: string } | null {
  const tab = sender.tab;
  if (
    tab?.id === undefined ||
    !tab.active ||
    sender.frameId !== 0 ||
    sender.documentId === undefined ||
    !supportedUrl(sender.url)
  ) {
    return null;
  }
  return { tabId: tab.id, windowId: tab.windowId, documentId: sender.documentId, url: sender.url };
}

function sameActiveDocument(
  tab: ChromeTab,
  expected: { tabId: number; windowId: number; url: string },
): boolean {
  return (
    tab.id === expected.tabId &&
    tab.windowId === expected.windowId &&
    tab.active &&
    tab.url === expected.url
  );
}

async function ensureOffscreenDocument(): Promise<void> {
  const offscreenDocumentUrl = chrome.runtime.getURL(OFFSCREEN_URL);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [offscreenDocumentUrl],
  });
  if (contexts.length === 0) {
    offscreenCreation ??= chrome.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: ["CLIPBOARD"],
        justification: "Write the user-approved HyperFrames capture to the OS clipboard.",
      })
      .finally(() => {
        offscreenCreation = null;
      });
    await offscreenCreation;
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const ready = await chrome.runtime.sendMessage({ kind: "offscreen.ping" }).catch(() => null);
    if (
      ready !== null &&
      typeof ready === "object" &&
      "kind" in ready &&
      ready.kind === "offscreen.ready"
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("The offscreen clipboard writer did not become ready.");
}

const clipboardWriter = new SerialClipboardWriter(async (text) => {
  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({ kind: "offscreen.write", text });
  if (
    response === null ||
    typeof response !== "object" ||
    !("ok" in response) ||
    response.ok !== true
  ) {
    throw new Error(
      response !== null && typeof response === "object" && "message" in response
        ? String(response.message)
        : "The offscreen clipboard writer did not confirm the write.",
    );
  }
});

async function activatePicker(): Promise<ExtensionResponse> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id === undefined || !supportedUrl(tab.url)) {
    return failure(
      "page.restricted",
      "Chrome does not allow element capture on this page. Open a normal website and try again.",
    );
  }
  let response: unknown;
  try {
    response = await chrome.tabs.sendMessage(tab.id, { kind: "activate" });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    response = await chrome.tabs.sendMessage(tab.id, { kind: "activate" });
  }
  return response && typeof response === "object" && "ok" in response
    ? response.ok === true
      ? { ok: true, kind: "activated" }
      : failure(
          "picker.unavailable",
          "message" in response ? String(response.message) : "The picker could not open.",
        )
    : failure("picker.unavailable", "The picker did not acknowledge activation.");
}

async function withActiveTabGuard<T>(
  identity: { tabId: number; windowId: number; url: string },
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error("Capture timed out.")),
    WEB_CAPTURE_BUDGETS.captureDeadlineMs,
  );
  const onActivated = ({ tabId, windowId }: { tabId: number; windowId: number }) => {
    if (windowId === identity.windowId && tabId !== identity.tabId) {
      controller.abort(new Error("The active tab changed during capture."));
    }
  };
  const onUpdated = (tabId: number, change: { status?: string; url?: string }) => {
    if (tabId === identity.tabId && (change.url !== undefined || change.status === "loading")) {
      controller.abort(new Error("The source page changed during capture."));
    }
  };
  chrome.tabs.onActivated.addListener(onActivated);
  chrome.tabs.onUpdated.addListener(onUpdated);
  try {
    const before = await chrome.tabs.get(identity.tabId);
    if (!sameActiveDocument(before, identity))
      throw new Error("The source tab is no longer active.");
    const result = await operation(controller.signal);
    controller.signal.throwIfAborted();
    const after = await chrome.tabs.get(identity.tabId);
    if (!sameActiveDocument(after, identity))
      throw new Error("The source tab changed during capture.");
    return result;
  } finally {
    clearTimeout(timeout);
    chrome.tabs.onActivated.removeListener(onActivated);
    chrome.tabs.onUpdated.removeListener(onUpdated);
  }
}

async function captureSelection(
  sender: ChromeMessageSender,
  rect: SelectionRect,
  editable: EditableDomDraft | null,
): Promise<ExtensionResponse> {
  const identity = activeTabIdentity(sender);
  if (!identity) return failure("capture.stale-source", "The selected page is no longer active.");
  try {
    return await withActiveTabGuard(identity, async (signal) => {
      let fullFrame: string | null = await chrome.tabs.captureVisibleTab(identity.windowId, {
        format: "png",
      });
      try {
        const crop = await cropVisiblePng(fullFrame, rect, signal);
        if (!crop) return failure("capture.not-visible", "The selection has no visible pixels.");
        let built = null;
        let artifactKind: "editable-dom" | "still" = "still";
        let opaqueIslandCount = 0;
        let modelIslandCount = 0;
        let fallbackCode: string | null = editable ? null : "representation.serializer-refused";
        if (editable) {
          const islands: Array<{
            id: string;
            crop: Awaited<ReturnType<typeof compressOpaqueCrop>>;
          }> = [];
          for (const island of editable.opaqueIslands) {
            const islandCrop = await cropVisiblePng(fullFrame, island.rect, signal);
            if (!islandCrop || islandCrop.completeness !== "complete") {
              islands.length = 0;
              break;
            }
            islands.push({ id: island.id, crop: await compressOpaqueCrop(islandCrop, signal) });
          }
          if (islands.length === editable.opaqueIslands.length) {
            built = await buildEditableCapture(editable, islands, rect, signal);
            if (built.ok) {
              artifactKind = "editable-dom";
              opaqueIslandCount = islands.length;
              modelIslandCount = editable.modelIslands.length;
            } else if (!built.code.startsWith("budget.")) {
              return failure(built.code, "The editable capture failed contract validation.");
            } else {
              fallbackCode = built.code;
            }
          }
        }
        if (!built?.ok) built = await buildStillCapture(crop, rect, signal);
        fullFrame = null;
        if (!built.ok) {
          return failure(built.code, "The selected still exceeds a capture safety limit.");
        }
        return {
          ok: true,
          kind: "locked",
          text: built.text,
          previewDataUrl: crop.dataUrl,
          width: crop.width,
          height: crop.height,
          bytes: utf8ByteLength(built.text),
          completeness: crop.completeness,
          artifactKind,
          opaqueIslandCount,
          modelIslandCount,
          fallbackCode,
        };
      } finally {
        fullFrame = null;
      }
    });
  } catch (error) {
    return failure(
      "capture.failed",
      error instanceof Error ? error.message : "Chrome could not capture the selected pixels.",
    );
  }
}

async function writeClipboard(
  sender: ChromeMessageSender,
  text: string,
): Promise<ExtensionResponse> {
  const identity = activeTabIdentity(sender);
  if (!identity) return failure("clipboard.stale-source", "The source page is no longer active.");
  try {
    const parsed = await validateCaptureText(text);
    if (!parsed.ok) return failure(parsed.code, "The locked capture is no longer valid.");
    await clipboardWriter.enqueue(parsed.canonicalText);
    return { ok: true, kind: "copied" };
  } catch (error) {
    return failure(
      "clipboard.write-failed",
      error instanceof Error ? error.message : "The OS clipboard rejected the capture.",
    );
  }
}

chrome.runtime.onMessage.addListener((raw, sender, respond) => {
  const message = parseExtensionRequest(raw);
  if (message?.kind === "offscreen.write" || message?.kind === "offscreen.ping") return;
  if (!message) {
    respond(failure("message.invalid", "The extension rejected an invalid message."));
    return;
  }
  const operation =
    message.kind === "activate"
      ? activatePicker()
      : message.kind === "capture-selection"
        ? captureSelection(sender, message.rect, message.editable)
        : writeClipboard(sender, message.text);
  void operation.then(respond, (error: unknown) =>
    respond(
      failure(
        "extension.failed",
        error instanceof Error ? error.message : "The extension could not complete the request.",
      ),
    ),
  );
  return true;
});
