// @ts-expect-error -- wawoff2 ships no type declarations; ambient .d.ts only visible to producer's own tsconfig
import wawoff2 from "wawoff2";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

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

type FontCompressionOptions = {
  cacheDir?: string;
  compressImpl?: (input: Buffer) => Promise<Buffer>;
};

function defaultCacheDir(): string {
  const root =
    process.env.HYPERFRAMES_FONT_CACHE_DIR ??
    (process.env.AWS_LAMBDA_FUNCTION_NAME
      ? join(tmpdir(), "hyperframes", "fonts")
      : join(homedir(), ".cache", "hyperframes", "fonts"));
  return join(root, "local-compression-v1");
}

function cachedCompressionPath(input: Buffer, originalFormat: string, cacheDir: string): string {
  const digest = createHash("sha256")
    .update("hyperframes-local-font-compression-v1\0")
    .update(originalFormat)
    .update("\0")
    .update(input)
    .digest("hex");
  return join(cacheDir, `${digest}.woff2`);
}

function readCachedCompression(path: string): Buffer | null {
  try {
    if (!existsSync(path)) return null;
    const cached = readFileSync(path);
    return cached.length > 0 ? cached : null;
  } catch {
    return null;
  }
}

function cacheCompression(path: string, compressed: Buffer): void {
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(tmpPath, compressed, { flag: "wx", mode: 0o644 });
    renameSync(tmpPath, path);
  } catch {
    // A concurrent process may have populated the cache, or the cache may be
    // read-only. Compression still succeeded, so rendering can continue.
  } finally {
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      // Best-effort cleanup only.
    }
  }
}

export async function fontToDataUri(
  input: Buffer,
  originalFormat: string,
  options: FontCompressionOptions = {},
): Promise<string> {
  if (originalFormat === "woff2") {
    return `data:font/woff2;base64,${input.toString("base64")}`;
  }
  if (originalFormat === "ttc") {
    return `data:font/collection;base64,${input.toString("base64")}`;
  }
  try {
    const cachePath = cachedCompressionPath(
      input,
      originalFormat,
      options.cacheDir ?? defaultCacheDir(),
    );
    const cached = readCachedCompression(cachePath);
    if (cached) return `data:font/woff2;base64,${cached.toString("base64")}`;

    const compressed = await (options.compressImpl ?? compressToWoff2)(input);
    cacheCompression(cachePath, compressed);
    return `data:font/woff2;base64,${compressed.toString("base64")}`;
  } catch {
    console.warn(
      `[fontCompression] woff2 compression failed for ${originalFormat} font, embedding raw format`,
    );
    return `data:${rawMimeType(originalFormat)};base64,${input.toString("base64")}`;
  }
}
