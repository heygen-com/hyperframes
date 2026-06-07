// @ts-expect-error -- wawoff2 ships no type declarations; ambient .d.ts only visible to producer's own tsconfig
import wawoff2 from "wawoff2";

const { compress } = wawoff2 as {
  compress: (input: Buffer | Uint8Array) => Promise<Uint8Array>;
};

export async function compressToWoff2(input: Buffer): Promise<Buffer> {
  return Buffer.from(await compress(input));
}

const RAW_MIME_TYPES: Record<string, string> = {
  otf: "font/otf",
  ttc: "font/collection",
};

function rawMimeType(format: string): string {
  return RAW_MIME_TYPES[format] ?? "font/ttf";
}

export async function fontToDataUri(input: Buffer, originalFormat: string): Promise<string> {
  if (originalFormat === "woff2") {
    return `data:font/woff2;base64,${input.toString("base64")}`;
  }
  try {
    const compressed = await compressToWoff2(input);
    return `data:font/woff2;base64,${compressed.toString("base64")}`;
  } catch {
    console.warn(
      `[fontCompression] woff2 compression failed for ${originalFormat} font, embedding raw format`,
    );
    return `data:${rawMimeType(originalFormat)};base64,${input.toString("base64")}`;
  }
}
