import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { captureImageExtension } from "./captureImageValidation.js";

function svg(content: string): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${content}</svg>`,
  );
}

describe("captured image validation", () => {
  it("validates embedded raster bytes and rejects false MIME claims", async () => {
    const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: "red" } })
      .png()
      .toBuffer();
    expect(
      await captureImageExtension(
        svg(`<image href="data:image/png;base64,${png.toString("base64")}"/>`),
      ),
    ).toBe(".svg");
    expect(
      await captureImageExtension(svg('<image href="data:image/png;base64,QUFBQUFBQUFB"/>')),
    ).toBeNull();
    expect(
      await captureImageExtension(
        svg(`<image href="data:image/jpeg;base64,${png.toString("base64")}"/>`),
      ),
    ).toBeNull();
  });

  it("limits the aggregate decoded pixel count of embedded rasters", async () => {
    const png = await sharp({
      create: { width: 5000, height: 5000, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    const encoded = png.toString("base64");
    expect(
      await captureImageExtension(
        svg(
          `<image href="data:image/png;base64,${encoded}"/><image href="data:image/PNG;base64,${encoded}"/>`,
        ),
      ),
    ).toBeNull();
  });
  it("recognizes actual PNG bytes without needing a trusted URL or content type", async () => {
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: "red" } })
      .png()
      .toBuffer();
    expect(await captureImageExtension(bytes)).toBe(".png");
    expect(await captureImageExtension(bytes.subarray(0, 40))).toBeNull();
    expect(await captureImageExtension(Buffer.alloc(6000, 65))).toBeNull();
  });

  it("preserves theme CSS, custom properties, and local gradient references", async () => {
    const bytes = svg(
      '<style>:root{--paint:red} @media(prefers-color-scheme:dark){:root{--paint:white}} path{fill:var(--paint)}</style><defs><linearGradient id="g"><stop stop-color="red"/></linearGradient></defs><path d="M0 0h24v24z" fill="url(#g)"/>',
    );
    const original = Buffer.from(bytes);
    expect(await captureImageExtension(bytes)).toBe(".svg");
    expect(bytes).toEqual(original);
  });

  it.each([
    "<script>alert(1)</script>",
    '<rect width="24" height="24" onload="alert(1)"/>',
    "<foreignObject><div>active HTML</div></foreignObject>",
    '<image href="https://private.example/image.png"/>',
    '<style>@import "https://private.example/style.css";</style>',
    "<style>path{fill:url(https://private.example/image.svg)}</style>",
    "<style>path{fill:u\\72l(https://private.example/image.svg)}</style>",
    '<set attributeName="href" to="https://private.example/image.svg"/>',
  ])("rejects active or externally loading SVG: %s", async (content) => {
    expect(await captureImageExtension(svg(content))).toBeNull();
  });
});
