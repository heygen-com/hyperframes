import {
  parseWebCaptureText,
  type WebCaptureFailure,
  type WebCaptureResourceMaterializer,
} from "@hyperframes/core/web-capture";

const WEB_CAPTURE_DURATION_SECONDS = 3;
const WEB_CAPTURE_3D_RUNTIME_PATH = "assets/hyperframes-web-capture-3d-v1.js";
const WEB_CAPTURE_3D_RUNTIME_CHILD_SRC = "assets/hyperframes-web-capture-3d-v1.js";

const SAFE_ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
const SAFE_OPERATION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SAFE_CHILD_PATH_RE = /^compositions\/web-captures\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.html$/;
const FORBIDDEN_TAGS = new Set([
  "base",
  "embed",
  "iframe",
  "link",
  "meta",
  "object",
  "script",
  "template",
]);

export interface WebCaptureImportIdentity {
  operationId: string;
  childPath: string;
  compositionId: string;
  rootDomId: string;
  rootHfId: string;
}

export interface WebCaptureImportPlan {
  kind: "editable-dom" | "still";
  operationId: string;
  child: { path: string; source: string };
  supportingFiles: ReadonlyArray<{ path: string; source: string }>;
  host: {
    sourcePath: string;
    start: number;
    duration: number;
    width: number;
    height: number;
  };
  warnings: Array<"opaque.replaced" | "model.localized" | "still.cropped">;
}

export type WebCaptureImportRejection =
  | { kind: "contract"; failure: WebCaptureFailure }
  | { kind: "artifact.unsupported"; artifactKind: "finite-local-media" }
  | { kind: "artifact.unsafe"; reason: string }
  | { kind: "placement.invalid-playhead" }
  | { kind: "identity.invalid"; field: keyof WebCaptureImportIdentity };

export type WebCaptureImportResult =
  | { ok: true; plan: WebCaptureImportPlan }
  | { ok: false; reason: WebCaptureImportRejection };

export interface WebCaptureImportInput {
  text: string;
  customMimeText?: string;
  playhead: number;
  materializeResource: WebCaptureResourceMaterializer;
  allocateIdentity: () => WebCaptureImportIdentity;
  signal?: AbortSignal;
}

function invalidIdentityField(
  identity: WebCaptureImportIdentity,
): keyof WebCaptureImportIdentity | null {
  if (!SAFE_OPERATION_ID_RE.test(identity.operationId)) return "operationId";
  if (!SAFE_CHILD_PATH_RE.test(identity.childPath)) return "childPath";
  const idFields = ["compositionId", "rootDomId", "rootHfId"] as const;
  for (const field of idFields) {
    if (!SAFE_ID_RE.test(identity[field])) return field;
  }
  const duplicate = idFields.find(
    (field, index) =>
      idFields.findIndex((candidate) => identity[candidate] === identity[field]) < index,
  );
  return duplicate ?? null;
}

function dataUrl(resource: { mime: string; data: string }): string {
  return `data:${resource.mime};base64,${resource.data}`;
}

function safeStyle(value: string): boolean {
  const lower = value.toLowerCase();
  return !lower.includes("url(") && !lower.includes("expression(") && !lower.includes("@import");
}

function sanitizeEditableHtml(
  html: string,
  css: string,
  resources: ReadonlyArray<{ id: string; kind: string; mime: string; data: string }>,
):
  | { ok: true; html: string; css: string; opaqueCount: number; modelCount: number }
  | { ok: false; reason: string } {
  if (!safeStyle(css) || css.includes("</style")) return { ok: false, reason: "unsafe CSS" };
  const document = new DOMParser().parseFromString(
    "<!doctype html><html><body></body></html>",
    "text/html",
  );
  const template = document.createElement("template");
  template.innerHTML = html;
  let root = template.content.firstElementChild;
  if (!root || template.content.children.length !== 1) {
    return { ok: false, reason: "capture must contain one root element" };
  }
  const resourcesById = new Map(resources.map((resource) => [resource.id, resource]));
  const consumed = new Set<string>();
  for (const element of [root, ...root.querySelectorAll("*")]) {
    if (FORBIDDEN_TAGS.has(element.tagName.toLowerCase())) {
      return { ok: false, reason: `forbidden ${element.tagName.toLowerCase()} element` };
    }
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || name === "srcdoc" || name === "href" || name === "srcset") {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (name === "style" && !safeStyle(attribute.value)) {
        return { ok: false, reason: "unsafe inline CSS" };
      }
      if (name === "id" || name === "data-hf-id") element.removeAttribute(attribute.name);
    }
    const resourceId = element.getAttribute("data-hf-resource-id");
    const modelResourceId = element.getAttribute("data-hf-model-resource-id");
    if (resourceId && modelResourceId) {
      return { ok: false, reason: "resource placeholder has conflicting kinds" };
    }
    if (!resourceId && !modelResourceId) {
      if (element.hasAttribute("src")) element.removeAttribute("src");
      continue;
    }
    const consumedId = resourceId ?? modelResourceId!;
    const resource = resourcesById.get(consumedId);
    if (resourceId) {
      if (element.tagName !== "IMG")
        return { ok: false, reason: "resource placeholder is not an image" };
      if (!resource || resource.kind !== "image") {
        return { ok: false, reason: `missing image resource ${resourceId}` };
      }
      element.setAttribute("src", dataUrl(resource));
      element.removeAttribute("data-hf-resource-id");
    } else {
      if (element.tagName !== "DIV") return { ok: false, reason: "model placeholder is not a div" };
      if (!resource || resource.kind !== "model" || resource.mime !== "model/gltf-binary") {
        return { ok: false, reason: `missing model resource ${modelResourceId}` };
      }
      const viewer = document.createElement("model-viewer");
      viewer.setAttribute("data-hf-editable-3d", "true");
      viewer.setAttribute(
        "data-hf-model-controls",
        "camera transform material environment animation",
      );
      viewer.setAttribute("data-hf-captured-tag", "canvas");
      viewer.setAttribute("camera-controls", "");
      viewer.setAttribute("interaction-prompt", "none");
      viewer.setAttribute("loading", "eager");
      viewer.setAttribute("reveal", "auto");
      viewer.setAttribute("camera-orbit", "45deg 65deg auto");
      viewer.setAttribute("camera-target", "auto auto auto");
      viewer.setAttribute("interpolation-decay", "0");
      viewer.setAttribute("orientation", "0deg 0deg 0deg");
      viewer.setAttribute("scale", "1 1 1");
      viewer.setAttribute("exposure", "1");
      viewer.setAttribute("shadow-intensity", "1");
      viewer.setAttribute("data-hf-model-src", dataUrl(resource));
      const style = element.getAttribute("style");
      if (style) viewer.setAttribute("style", style);
      element.replaceWith(viewer);
      if (element === root) root = viewer;
    }
    consumed.add(consumedId);
  }
  if (consumed.size !== resources.length) return { ok: false, reason: "unused capture resource" };
  return {
    ok: true,
    html: root.outerHTML,
    css,
    opaqueCount: resources.filter((resource) => resource.kind === "image").length,
    modelCount: resources.filter((resource) => resource.kind === "model").length,
  };
}

function childSource(input: {
  identity: WebCaptureImportIdentity;
  width: number;
  height: number;
  body: string;
  css?: string;
  has3d?: boolean;
}): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    "  <style>",
    "    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }",
    "    .web-capture-root { position: absolute; inset: 0; width: 100%; height: 100%; overflow: hidden; }",
    "    .web-capture-root, .web-capture-root * { box-sizing: border-box; }",
    "    .web-capture-root * { margin: 0; padding: 0; border: 0; }",
    input.css ? `    ${input.css}` : "",
    "  </style>",
    input.has3d
      ? `  <script src="${WEB_CAPTURE_3D_RUNTIME_CHILD_SRC}" data-hf-trusted-runtime="model-viewer"></script>`
      : "",
    "</head>",
    "<body>",
    `  <main data-composition-id="${input.identity.compositionId}" data-duration="${WEB_CAPTURE_DURATION_SECONDS}" data-width="${input.width}" data-height="${input.height}" data-no-timeline>`,
    `    <div id="${input.identity.rootDomId}" data-hf-id="${input.identity.rootHfId}" class="clip web-capture-root" data-start="0" data-duration="${WEB_CAPTURE_DURATION_SECONDS}" data-track-index="0">${input.body}</div>`,
    "  </main>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

export async function planWebCaptureImport(
  input: WebCaptureImportInput,
): Promise<WebCaptureImportResult> {
  const parsed = await parseWebCaptureText(input.text, {
    materializeResource: input.materializeResource,
    customMimeText: input.customMimeText,
    signal: input.signal,
  });
  if (!parsed.ok) return { ok: false, reason: { kind: "contract", failure: parsed } };
  if (parsed.envelope.artifact.kind === "finite-local-media") {
    return {
      ok: false,
      reason: { kind: "artifact.unsupported", artifactKind: "finite-local-media" },
    };
  }
  if (!Number.isFinite(input.playhead) || input.playhead < 0) {
    return { ok: false, reason: { kind: "placement.invalid-playhead" } };
  }
  const identity = input.allocateIdentity();
  const invalidField = invalidIdentityField(identity);
  if (invalidField) return { ok: false, reason: { kind: "identity.invalid", field: invalidField } };

  const artifact = parsed.envelope.artifact;
  let body: string;
  let warnings: WebCaptureImportPlan["warnings"] = [];
  if (artifact.kind === "still") {
    const resource = parsed.envelope.resources.find(({ id }) => id === artifact.resourceId);
    if (resource?.kind !== "image") throw new Error("Validated still has no image resource");
    body = `<img data-hf-captured-tag="img" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain" src="${dataUrl(resource)}" alt="" />`;
    if (artifact.completeness === "cropped") warnings = ["still.cropped"];
  } else {
    const sanitized = sanitizeEditableHtml(artifact.html, artifact.css, parsed.envelope.resources);
    if (!sanitized.ok) {
      return { ok: false, reason: { kind: "artifact.unsafe", reason: sanitized.reason } };
    }
    body = sanitized.html;
    if (sanitized.opaqueCount > 0) warnings.push("opaque.replaced");
    if (sanitized.modelCount > 0) warnings.push("model.localized");
  }

  const has3d = warnings.includes("model.localized");
  const supportingFiles = has3d
    ? [
        {
          path: WEB_CAPTURE_3D_RUNTIME_PATH,
          source: (await import("./webCapture3dRuntime")).trustedWebCapture3dRuntimeSource(),
        },
      ]
    : [];

  return {
    ok: true,
    plan: {
      kind: artifact.kind,
      operationId: identity.operationId,
      child: {
        path: identity.childPath,
        source: childSource({
          identity,
          width: artifact.width,
          height: artifact.height,
          body,
          css: artifact.kind === "editable-dom" ? artifact.css : undefined,
          has3d,
        }),
      },
      supportingFiles,
      host: {
        sourcePath: identity.childPath,
        start: input.playhead,
        duration: WEB_CAPTURE_DURATION_SECONDS,
        width: artifact.width,
        height: artifact.height,
      },
      warnings,
    },
  };
}
