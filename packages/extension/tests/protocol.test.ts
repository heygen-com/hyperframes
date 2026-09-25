import { WEB_CAPTURE_BUDGETS } from "@hyperframes/core/web-capture";
import { describe, expect, it } from "vitest";
import { parseExtensionRequest } from "../src/protocol";

describe("parseExtensionRequest", () => {
  it("accepts one exact capture request", () => {
    const request = {
      kind: "capture-selection",
      epoch: "epoch-1",
      rect: {
        left: 1,
        top: 2,
        width: 3,
        height: 4,
        viewportWidth: 100,
        viewportHeight: 200,
        devicePixelRatio: 2,
      },
      editable: null,
    };
    expect(parseExtensionRequest(request)).toEqual(request);
  });

  it("rejects unknown keys and non-positive geometry", () => {
    expect(parseExtensionRequest({ kind: "activate", page: "hostile" })).toBeNull();
    expect(
      parseExtensionRequest({
        kind: "capture-selection",
        epoch: "epoch-1",
        rect: {
          left: 0,
          top: 0,
          width: 0,
          height: 10,
          viewportWidth: 100,
          viewportHeight: 100,
          devicePixelRatio: 1,
        },
        editable: null,
      }),
    ).toBeNull();
  });

  it("rejects clipboard text over the shared contract budget", () => {
    const text = "x".repeat(WEB_CAPTURE_BUDGETS.finalUtf8Bytes + 1);
    expect(parseExtensionRequest({ kind: "write-clipboard", epoch: "epoch-1", text })).toBeNull();
  });

  it("accepts only the exact side-effect-free offscreen readiness probe", () => {
    expect(parseExtensionRequest({ kind: "offscreen.ping" })).toEqual({
      kind: "offscreen.ping",
    });
    expect(parseExtensionRequest({ kind: "offscreen.ping", text: "hostile" })).toBeNull();
  });

  it("accepts a bounded local GLB island and rejects a remote source field", () => {
    const editable = {
      html: '<div data-hf-model-resource-id="model-1"></div>',
      css: "",
      width: 100,
      height: 100,
      opaqueIslands: [],
      modelIslands: [
        {
          id: "model-1",
          mime: "model/gltf-binary",
          bytes: 4,
          data: "Z2xURg==",
          sourceName: "phone.glb",
        },
      ],
    };
    const request = {
      kind: "capture-selection",
      epoch: "epoch-1",
      rect: {
        left: 0,
        top: 0,
        width: 100,
        height: 100,
        viewportWidth: 100,
        viewportHeight: 100,
        devicePixelRatio: 1,
      },
      editable,
    };
    expect(parseExtensionRequest(request)).toEqual(request);
    expect(
      parseExtensionRequest({
        ...request,
        editable: {
          ...editable,
          modelIslands: [{ ...editable.modelIslands[0], sourceUrl: "https://host/phone.glb" }],
        },
      }),
    ).toBeNull();
  });
});
