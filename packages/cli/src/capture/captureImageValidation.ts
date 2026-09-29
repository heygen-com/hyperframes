import sharp from "sharp";
import { DOMParser } from "linkedom";
import { parse, walk } from "css-tree";

const SVG_ELEMENTS = new Set(
  "svg g defs title desc metadata path rect circle ellipse line polyline polygon text tspan textPath use symbol image clipPath mask pattern marker linearGradient radialGradient stop filter feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feImage feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile feTurbulence style"
    .toLowerCase()
    .split(" "),
);

function localImageReference(value: string, embedded: Set<string>): boolean {
  const ref = value.trim();
  if (ref.startsWith("#")) return true;
  if (!/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(ref)) return false;
  embedded.add(ref);
  return true;
}

function passiveCss(
  source: string,
  context: "stylesheet" | "declarationList" | "value",
  embedded: Set<string>,
): boolean {
  // Escapes can disguise fetch-bearing tokens; keep the accepted spelling unambiguous.
  if (source.includes("\\")) return false;
  let safe = true;
  try {
    walk(parse(source, { context, parseCustomProperty: true }), (node) => {
      if (node.type === "Raw") safe = false;
      if (
        node.type === "Function" &&
        ["image", "image-set", "-webkit-image-set", "src", "paint"].includes(
          node.name.toLowerCase(),
        )
      )
        safe = false;
      if (node.type === "Url" && !localImageReference(node.value, embedded)) safe = false;
      if (
        node.type === "Atrule" &&
        !["media", "supports", "keyframes"].includes(node.name.toLowerCase())
      )
        safe = false;
    });
    return safe;
  } catch {
    return false;
  }
}

/** Accept passive SVG without reserializing it or losing theme-dependent paint. */
function passiveSvg(bytes: Buffer, embedded: Set<string>): boolean {
  const source = bytes.toString("utf8");
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(source)) return false;
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  const root = document.documentElement;
  if (root?.localName !== "svg") return false;
  const elements = [root, ...Array.from(root.querySelectorAll("*"))];
  if (elements.length > 10000) return false;
  return elements.every((element) => {
    if (!SVG_ELEMENTS.has(element.localName.toLowerCase())) return false;
    if (
      element.localName === "style" &&
      !passiveCss(element.textContent ?? "", "stylesheet", embedded)
    )
      return false;
    return element
      .getAttributeNames()
      .every((attribute: string) =>
        passiveSvgAttribute(
          attribute.toLowerCase(),
          element.getAttribute(attribute) ?? "",
          embedded,
        ),
      );
  });
}

function passiveSvgAttribute(name: string, value: string, embedded: Set<string>): boolean {
  if (name.startsWith("on") || name === "xml:base") return false;
  if (["href", "xlink:href", "src"].includes(name)) return localImageReference(value, embedded);
  if (name === "style") return passiveCss(value, "declarationList", embedded);
  return !/url\s*\(|\\/i.test(value) || passiveCss(value, "value", embedded);
}

async function validIco(bytes: Buffer): Promise<boolean> {
  if (bytes.length < 22 || bytes.readUInt32LE(0) !== 0x00010000) return false;
  const count = bytes.readUInt16LE(4);
  if (count === 0 || count > 256 || 6 + count * 16 > bytes.length) return false;
  for (let i = 0; i < count; i++) {
    const size = bytes.readUInt32LE(6 + i * 16 + 8);
    const offset = bytes.readUInt32LE(6 + i * 16 + 12);
    if (!validIconEntry(size, offset, 6 + count * 16, bytes.length)) return false;
    if (!(await validIconImage(bytes.subarray(offset, offset + size)))) return false;
  }
  return true;
}

function validIconEntry(
  size: number,
  offset: number,
  directoryEnd: number,
  length: number,
): boolean {
  return size >= 40 && offset >= directoryEnd && size <= length - offset;
}

async function validIconImage(bytes: Buffer): Promise<boolean> {
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (!png) return validIconBitmap(bytes);
  try {
    await sharp(bytes, { limitInputPixels: 65536 }).resize(1, 1).raw().toBuffer();
    return true;
  } catch {
    return false;
  }
}

function validIconBitmap(bytes: Buffer): boolean {
  const dibSize = bytes.readUInt32LE(0);
  if (![40, 108, 124].includes(dibSize) || bytes.length < dibSize) return false;
  const width = bytes.readInt32LE(4);
  const height = bytes.readInt32LE(8);
  const bits = bytes.readUInt16LE(14);
  if (!validIconDimensions(width, height)) return false;
  if (bytes.readUInt16LE(12) !== 1 || ![1, 4, 8, 16, 24, 32].includes(bits)) return false;
  if (bytes.readUInt32LE(16) !== 0) return false;
  const pixels = Math.ceil((width * bits) / 32) * 4 * (height / 2);
  const palette = bits <= 8 ? 4 * (1 << bits) : 0;
  return dibSize + palette + pixels <= bytes.length;
}

function validIconDimensions(width: number, height: number): boolean {
  return width > 0 && width <= 256 && height > 0 && height <= 512 && height % 2 === 0;
}

/** Choose a canonical image extension from the content, never a remote URL suffix. */
export async function captureImageExtension(bytes: Buffer): Promise<string | null> {
  if (await validIco(bytes)) return ".ico";
  try {
    const embedded = new Set<string>();
    // Reject active XML before passing it to an image decoder.
    if (/^\s*</.test(bytes.toString("utf8", 0, 256)) && !passiveSvg(bytes, embedded)) return null;
    const image = sharp(bytes, { limitInputPixels: 40_000_000 });
    const metadata = await image.metadata();
    if (metadata.format === "svg") {
      if (!passiveSvg(bytes, embedded) || !(await validEmbeddedImages(embedded))) return null;
      return ".svg";
    }
    const extensions: Record<string, string> = {
      jpeg: ".jpg",
      png: ".png",
      webp: ".webp",
      gif: ".gif",
      avif: ".avif",
      heif: metadata.compression === "av1" ? ".avif" : ".heic",
      tiff: ".tiff",
    };
    const extension = metadata.format && extensions[metadata.format];
    if (!extension) return null;
    await image.resize(1, 1).raw().toBuffer();
    return extension;
  } catch {
    return null;
  }
}

async function validEmbeddedImages(references: Set<string>): Promise<boolean> {
  let remainingBytes = 10 * 1024 * 1024;
  let remainingPixels = 40_000_000;
  for (const reference of references) {
    const comma = reference.indexOf(",");
    const type = reference.slice(11, reference.indexOf(";")).toLowerCase();
    const encoded = reference.slice(comma + 1).replace(/\s/g, "");
    if (encoded.length > Math.ceil(remainingBytes / 3) * 4) return false;
    const bytes = Buffer.from(encoded, "base64");
    remainingBytes -= bytes.length;
    if (remainingBytes < 0) return false;
    const image = sharp(bytes, { limitInputPixels: remainingPixels });
    const metadata = await image.metadata();
    if (metadata.format !== type || !metadata.width || !metadata.height) return false;
    const pixels = metadata.width * metadata.height * (metadata.pages ?? 1);
    remainingPixels -= pixels;
    if (remainingPixels < 0) return false;
    await image.resize(1, 1).raw().toBuffer();
  }
  return true;
}
