import { WEB_CAPTURE_BUDGETS, utf8ByteLength } from "@hyperframes/core/web-capture";

export interface SelectionRect {
  left: number;
  top: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
}

export interface EditableDomDraft {
  html: string;
  css: string;
  width: number;
  height: number;
  opaqueIslands: Array<{ id: string; rect: SelectionRect }>;
  modelIslands: Array<{
    id: string;
    mime: "model/gltf-binary";
    bytes: number;
    data: string;
    sourceName: string;
  }>;
}

export type ExtensionRequest =
  | { kind: "activate" }
  | {
      kind: "capture-selection";
      epoch: string;
      rect: SelectionRect;
      editable: EditableDomDraft | null;
    }
  | { kind: "write-clipboard"; epoch: string; text: string }
  | { kind: "offscreen.ping" }
  | { kind: "offscreen.write"; text: string };

export type ExtensionResponse =
  | { ok: true; kind: "activated" }
  | {
      ok: true;
      kind: "locked";
      text: string;
      previewDataUrl: string;
      width: number;
      height: number;
      bytes: number;
      completeness: "complete" | "cropped";
      artifactKind: "editable-dom" | "still";
      opaqueIslandCount: number;
      modelIslandCount: number;
      fallbackCode: string | null;
    }
  | { ok: true; kind: "copied" }
  | { ok: false; code: string; message: string };

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseRect(value: unknown): SelectionRect | null {
  if (!isRecord(value)) return null;
  const keys: (keyof SelectionRect)[] = [
    "left",
    "top",
    "width",
    "height",
    "viewportWidth",
    "viewportHeight",
    "devicePixelRatio",
  ];
  if (Object.keys(value).some((key) => !keys.includes(key as keyof SelectionRect))) return null;
  const { left, top, width, height, viewportWidth, viewportHeight, devicePixelRatio } = value;
  if (
    !isFiniteNumber(left) ||
    !isFiniteNumber(top) ||
    !isFiniteNumber(width) ||
    !isFiniteNumber(height) ||
    !isFiniteNumber(viewportWidth) ||
    !isFiniteNumber(viewportHeight) ||
    !isFiniteNumber(devicePixelRatio)
  ) {
    return null;
  }
  const rect = {
    left,
    top,
    width,
    height,
    viewportWidth,
    viewportHeight,
    devicePixelRatio,
  };
  return rect.width > 0 &&
    rect.height > 0 &&
    rect.viewportWidth > 0 &&
    rect.viewportHeight > 0 &&
    rect.devicePixelRatio > 0
    ? rect
    : null;
}

function parseEditableDraft(value: unknown): EditableDomDraft | null {
  if (!isRecord(value)) return null;
  const keys = ["html", "css", "width", "height", "opaqueIslands", "modelIslands"];
  if (Object.keys(value).some((key) => !keys.includes(key))) return null;
  if (
    typeof value.html !== "string" ||
    typeof value.css !== "string" ||
    !isFiniteNumber(value.width) ||
    !isFiniteNumber(value.height) ||
    value.width <= 0 ||
    value.height <= 0 ||
    utf8ByteLength(value.html) + utf8ByteLength(value.css) > WEB_CAPTURE_BUDGETS.htmlCssBytes ||
    !Array.isArray(value.opaqueIslands) ||
    value.opaqueIslands.length > WEB_CAPTURE_BUDGETS.resources ||
    !Array.isArray(value.modelIslands) ||
    value.opaqueIslands.length + value.modelIslands.length > WEB_CAPTURE_BUDGETS.resources
  ) {
    return null;
  }
  const opaqueIslands: EditableDomDraft["opaqueIslands"] = [];
  const ids = new Set<string>();
  for (const candidate of value.opaqueIslands) {
    if (
      !isRecord(candidate) ||
      Object.keys(candidate).some((key) => !["id", "rect"].includes(key))
    ) {
      return null;
    }
    const rect = parseRect(candidate.rect);
    if (
      typeof candidate.id !== "string" ||
      !/^opaque-[1-9][0-9]*$/.test(candidate.id) ||
      ids.has(candidate.id) ||
      !rect
    ) {
      return null;
    }
    ids.add(candidate.id);
    opaqueIslands.push({ id: candidate.id, rect });
  }
  const modelIslands: EditableDomDraft["modelIslands"] = [];
  for (const candidate of value.modelIslands) {
    if (
      !isRecord(candidate) ||
      Object.keys(candidate).some(
        (key) => !["id", "mime", "bytes", "data", "sourceName"].includes(key),
      ) ||
      typeof candidate.id !== "string" ||
      !/^model-[1-9][0-9]*$/.test(candidate.id) ||
      ids.has(candidate.id) ||
      candidate.mime !== "model/gltf-binary" ||
      !Number.isSafeInteger(candidate.bytes) ||
      (candidate.bytes as number) <= 0 ||
      (candidate.bytes as number) > WEB_CAPTURE_BUDGETS.modelBytes ||
      typeof candidate.data !== "string" ||
      candidate.data.length > Math.ceil(((candidate.bytes as number) * 4) / 3) + 4 ||
      typeof candidate.sourceName !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.glb$/i.test(candidate.sourceName)
    ) {
      return null;
    }
    ids.add(candidate.id);
    modelIslands.push({
      id: candidate.id,
      mime: candidate.mime,
      bytes: candidate.bytes as number,
      data: candidate.data,
      sourceName: candidate.sourceName,
    });
  }
  return {
    html: value.html,
    css: value.css,
    width: value.width,
    height: value.height,
    opaqueIslands,
    modelIslands,
  };
}

export function parseExtensionRequest(value: unknown): ExtensionRequest | null {
  if (!isRecord(value) || typeof value.kind !== "string") return null;
  switch (value.kind) {
    case "activate":
      return Object.keys(value).length === 1 ? { kind: "activate" } : null;
    case "capture-selection": {
      const rect = parseRect(value.rect);
      const editable = value.editable === null ? null : parseEditableDraft(value.editable);
      return Object.keys(value).length === 4 &&
        typeof value.epoch === "string" &&
        rect &&
        (value.editable === null || editable)
        ? { kind: "capture-selection", epoch: value.epoch, rect, editable }
        : null;
    }
    case "write-clipboard":
      return Object.keys(value).length === 3 &&
        typeof value.epoch === "string" &&
        typeof value.text === "string" &&
        utf8ByteLength(value.text) <= WEB_CAPTURE_BUDGETS.finalUtf8Bytes
        ? { kind: "write-clipboard", epoch: value.epoch, text: value.text }
        : null;
    case "offscreen.write":
      return Object.keys(value).length === 2 &&
        typeof value.text === "string" &&
        utf8ByteLength(value.text) <= WEB_CAPTURE_BUDGETS.finalUtf8Bytes
        ? { kind: "offscreen.write", text: value.text }
        : null;
    case "offscreen.ping":
      return Object.keys(value).length === 1 ? { kind: "offscreen.ping" } : null;
    default:
      return null;
  }
}
