// @vitest-environment happy-dom

import {
  buildWebCaptureText,
  sha256Hex,
  type WebCaptureEnvelopeInput,
  type WebCaptureResourceMaterializer,
} from "@hyperframes/core/web-capture";
import { describe, expect, it } from "vitest";
import { planWebCaptureImport, type WebCaptureImportIdentity } from "./webCaptureImport";

const PNG_DATA =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const PNG_BYTES = Uint8Array.from(atob(PNG_DATA), (character) => character.charCodeAt(0));
const materializeResource: WebCaptureResourceMaterializer = async (_bytes, inspected) => inspected;
const identity: WebCaptureImportIdentity = {
  operationId: "capture-1",
  childPath: "compositions/web-captures/capture-1.html",
  compositionId: "capture-one",
  rootDomId: "capture-root",
  rootHfId: "hf-capture-root",
};

async function textFor(input: WebCaptureEnvelopeInput): Promise<string> {
  const result = await buildWebCaptureText(input, { materializeResource });
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.text;
}

async function imageResource(id: string) {
  return {
    id,
    kind: "image" as const,
    mime: "image/png" as const,
    bytes: PNG_BYTES.byteLength,
    sha256: await sha256Hex(PNG_BYTES),
    data: PNG_DATA,
    width: 1,
    height: 1,
  };
}

function minimalGlb(): Uint8Array {
  const json = new TextEncoder().encode('{"asset":{"version":"2.0"}}');
  const padded = Math.ceil(json.length / 4) * 4;
  const bytes = new Uint8Array(20 + padded);
  const view = new DataView(bytes.buffer);
  bytes.set([0x67, 0x6c, 0x54, 0x46]);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.length, true);
  view.setUint32(12, padded, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20);
  bytes.set(json, 20);
  return bytes;
}

async function modelResource(id: string) {
  const bytes = minimalGlb();
  return {
    id,
    kind: "model" as const,
    mime: "model/gltf-binary" as const,
    bytes: bytes.byteLength,
    sha256: await sha256Hex(bytes),
    data: btoa(String.fromCharCode(...bytes)),
  };
}

function claims() {
  return {
    sourceFrame: { width: 1280, height: 720, devicePixelRatio: 1 },
    time: { kind: "locked-frame" as const, atMs: 0 },
    reflow: "fixed-viewport" as const,
  };
}

describe("planWebCaptureImport", () => {
  it("creates editable child HTML and localizes opaque islands", async () => {
    const resource = await imageResource("opaque-1");
    const text = await textFor({
      artifact: {
        kind: "editable-dom",
        html: '<article><h2>Editable title</h2><img data-hf-resource-id="opaque-1"></article>',
        css: "",
        width: 640,
        height: 360,
      },
      resources: [resource],
      diagnostics: [{ code: "opaque.replaced", count: 1 }],
      claims: claims(),
    });

    const result = await planWebCaptureImport({
      text,
      playhead: 2.5,
      materializeResource,
      allocateIdentity: () => identity,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.kind).toBe("editable-dom");
    expect(result.plan.child.source).toContain("Editable title");
    expect(result.plan.child.source).toContain(`src="data:image/png;base64,${PNG_DATA}"`);
    expect(result.plan.child.source).not.toContain("data-hf-resource-id");
    expect(result.plan.host.start).toBe(2.5);
    expect(result.plan.warnings).toEqual(["opaque.replaced"]);
    expect(result.plan.supportingFiles).toEqual([]);
  });

  it("rejects executable markup from a forged clipboard envelope", async () => {
    const text = await textFor({
      artifact: {
        kind: "editable-dom",
        html: "<section><script>evil()</script></section>",
        css: "",
        width: 100,
        height: 100,
      },
      resources: [],
      diagnostics: [],
      claims: claims(),
    });

    const result = await planWebCaptureImport({
      text,
      playhead: 0,
      materializeResource,
      allocateIdentity: () => identity,
    });

    expect(result).toEqual({
      ok: false,
      reason: { kind: "artifact.unsafe", reason: "forbidden script element" },
    });
  });

  it("creates a self-contained editable 3D island with no page code or remote model URL", async () => {
    const resource = await modelResource("model-1");
    const text = await textFor({
      artifact: {
        kind: "editable-dom",
        html: '<div data-hf-model-resource-id="model-1" style="width:640px;height:360px"></div>',
        css: "",
        width: 640,
        height: 360,
      },
      resources: [resource],
      diagnostics: [{ code: "model.localized", count: 1 }],
      claims: claims(),
    });

    const result = await planWebCaptureImport({
      text,
      playhead: 1,
      materializeResource,
      allocateIdentity: () => identity,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.warnings).toEqual(["model.localized"]);
    expect(result.plan.child.source).toContain("<model-viewer");
    expect(result.plan.child.source).toContain('data-hf-editable-3d="true"');
    expect(result.plan.child.source).toContain('camera-orbit="45deg 65deg auto"');
    expect(result.plan.child.source).toContain("data:model/gltf-binary;base64,");
    expect(result.plan.child.source).toContain('src="assets/hyperframes-web-capture-3d-v1.js"');
    expect(result.plan.supportingFiles).toHaveLength(1);
    expect(result.plan.supportingFiles[0]?.path).toBe("assets/hyperframes-web-capture-3d-v1.js");
    expect(result.plan.supportingFiles[0]?.source).toContain(
      'customElements.define("model-viewer"',
    );
    expect(result.plan.supportingFiles[0]?.source).toContain("draco_decoder.wasm");
    expect(result.plan.child.source).not.toContain("data-hf-model-resource-id");
    expect(result.plan.child.source).not.toContain("https://www.ultramock.io");
  });

  it("retains the Still representation as an honest fallback", async () => {
    const resource = await imageResource("still-1");
    const text = await textFor({
      artifact: {
        kind: "still",
        resourceId: "still-1",
        width: 1,
        height: 1,
        completeness: "complete",
      },
      resources: [resource],
      diagnostics: [],
      claims: claims(),
    });

    const result = await planWebCaptureImport({
      text,
      playhead: 0,
      materializeResource,
      allocateIdentity: () => identity,
    });

    expect(result.ok && result.plan.kind).toBe("still");
  });
});
