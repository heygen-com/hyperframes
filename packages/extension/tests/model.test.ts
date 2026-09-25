// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { discoverSameOriginGlb } from "../src/capture/model";

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

describe("discoverSameOriginGlb", () => {
  it("localizes the one same-origin GLB without following unrelated resources", async () => {
    const bytes = minimalGlb();
    const requested: string[] = [];
    const model = await discoverSameOriginGlb(
      [
        { name: "https://www.ultramock.io/models/phone.glb" },
        { name: "https://cdn.example/foreign.glb" },
        { name: "https://www.ultramock.io/app.js" },
      ],
      "https://www.ultramock.io/editor",
      async (url) => {
        requested.push(url);
        return new Response(bytes.slice().buffer, {
          headers: { "content-type": "model/gltf-binary" },
        });
      },
    );

    expect(requested).toEqual(["https://www.ultramock.io/models/phone.glb"]);
    expect(model).toMatchObject({
      mime: "model/gltf-binary",
      bytes: bytes.byteLength,
      sourceName: "phone.glb",
    });
  });

  it("refuses an ambiguous page instead of guessing which model belongs to the canvas", async () => {
    const model = await discoverSameOriginGlb(
      [{ name: "/one.glb" }, { name: "/two.glb" }],
      "https://example.com/editor",
    );
    expect(model).toBeNull();
  });
});
