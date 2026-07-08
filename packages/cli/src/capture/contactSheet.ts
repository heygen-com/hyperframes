/**
 * Generate labeled contact sheet grids from images.
 *
 * Stitches images into a numbered grid with cell labels.
 * Saves 50-65% tokens vs. AI agents reading images individually.
 */

import sharp from "sharp";
import { readdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join, extname, basename, dirname } from "node:path";

interface ContactSheetOptions {
  cols?: number;
  maxImages?: number;
  padding?: number;
  labelMode?: "index" | "filename" | "custom";
  labels?: string[];
  quality?: number;
  /** Target width per cell in pixels (default: 600) */
  cellWidth?: number;
}

/**
 * Create a contact sheet from a list of image paths.
 * Returns the output file path, or null if no images.
 */
export async function createContactSheet(
  imagePaths: string[],
  outputPath: string,
  opts: ContactSheetOptions = {},
): Promise<string | null> {
  const {
    cols = 3,
    maxImages = 16,
    padding = 4,
    labelMode = "index",
    labels,
    quality = 88,
    cellWidth = 600,
  } = opts;

  const files = imagePaths.slice(0, maxImages);
  if (files.length === 0) return null;

  // Read first image to determine aspect ratio
  const firstMeta = await sharp(files[0]!).metadata();
  const srcW = firstMeta.width || 1920;
  const srcH = firstMeta.height || 1080;

  // Scale to target cell width, maintain aspect ratio
  const scale = cellWidth / srcW;
  const cellW = cellWidth;
  const cellH = Math.round(srcH * scale);

  const rows = Math.ceil(files.length / cols);
  const labelH = 26;
  const totalW = cols * cellW + (cols + 1) * padding;
  const totalH = rows * (cellH + labelH) + (rows + 1) * padding;

  const overlays: sharp.OverlayOptions[] = [];

  for (let i = 0; i < files.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = padding + col * (cellW + padding);
    const y = padding + row * (cellH + labelH + padding);

    // Resize image to cell size — contain keeps full image visible (no cropping)
    const resized = await sharp(files[i]!)
      .resize(cellW, cellH, { fit: "contain", background: { r: 26, g: 26, b: 26 } })
      .toBuffer();

    overlays.push({ input: resized, left: x, top: y + labelH });

    // Label text
    let labelText = `${i + 1}`;
    if (labelMode === "filename") {
      labelText = `${i + 1}. ${basename(files[i]!).replace(extname(files[i]!), "")}`;
    } else if (labelMode === "custom" && labels?.[i]) {
      labelText = `${i + 1}. ${labels[i]}`;
    }

    // Truncate label to fit cell
    if (labelText.length > 60) labelText = labelText.slice(0, 57) + "...";

    const labelSvg = Buffer.from(
      `<svg width="${cellW}" height="${labelH}">` +
        `<rect width="${cellW}" height="${labelH}" fill="#1a1a1a"/>` +
        `<text x="8" y="18" font-family="Arial,Helvetica,sans-serif" font-size="13" font-weight="bold" fill="#ffffff">${escapeXml(labelText)}</text>` +
        `</svg>`,
    );

    overlays.push({ input: labelSvg, left: x, top: y });
  }

  const sheet = sharp({
    create: {
      width: totalW,
      height: totalH,
      channels: 3,
      background: { r: 26, g: 26, b: 26 },
    },
  }).composite(overlays);

  if (extname(outputPath).toLowerCase() === ".png") {
    await sheet.png().toFile(outputPath);
  } else {
    await sheet.jpeg({ quality }).toFile(outputPath);
  }

  return outputPath;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Split imagePaths into pages of `pageSize`, write one contact sheet per page.
 * Output files: basePath → base-1.jpg, base-2.jpg, ...
 * Returns the list of written file paths (empty if no images).
 */
async function createContactSheetPages(
  imagePaths: string[],
  outputBasePath: string,
  opts: ContactSheetOptions & { pageSize?: number } = {},
  labelOffset = 0,
  customLabels?: string[],
): Promise<string[]> {
  if (imagePaths.length === 0) return [];
  const { pageSize = imagePaths.length, ...sheetOpts } = opts;
  const ext = outputBasePath.match(/\.[^.]+$/)?.[0] ?? ".jpg";
  const base = outputBasePath.slice(0, -ext.length);

  const pages = Math.ceil(imagePaths.length / pageSize);
  const results: string[] = [];

  for (let p = 0; p < pages; p++) {
    const chunk = imagePaths.slice(p * pageSize, (p + 1) * pageSize);
    const chunkLabels = customLabels?.slice(p * pageSize, (p + 1) * pageSize);
    const outPath = pages === 1 ? outputBasePath : `${base}-${p + 1}${ext}`;

    const labelsForChunk = chunkLabels
      ? { labelMode: "custom" as const, labels: chunkLabels }
      : sheetOpts.labelMode === "filename"
        ? { labelMode: "filename" as const }
        : { labelMode: "index" as const };

    const written = await createContactSheet(chunk, outPath, {
      ...sheetOpts,
      ...labelsForChunk,
      maxImages: chunk.length,
    });
    if (written) results.push(written);
    void labelOffset; // used by callers that pre-compute labels
  }
  return results;
}

/**
 * Contact sheet for scroll screenshots. Paginated — all screenshots covered.
 * Labels: "1. 0% scroll", "2. 23% scroll", etc.
 * Returns array of written file paths.
 */
export async function createScrollContactSheet(
  screenshotsDir: string,
  outputPath: string,
): Promise<string[]> {
  if (!existsSync(screenshotsDir)) return [];

  const scrollFiles = readdirSync(screenshotsDir)
    .filter((f) => f.startsWith("scroll-") && f.endsWith(".png"))
    .sort();

  if (scrollFiles.length === 0) return [];

  const paths = scrollFiles.map((f) => join(screenshotsDir, f));
  const labels = scrollFiles.map((f) => {
    const m = f.match(/scroll-(\d+)\.png/);
    return m ? `${m[1]}% scroll` : f;
  });

  // 3 cols max for readability; 9 per page (3×3) so cells stay large enough to read
  return createContactSheetPages(
    paths,
    outputPath,
    { cols: 3, cellWidth: 600, pageSize: 9 },
    0,
    labels,
  );
}

/**
 * Contact sheet for snapshot frames. All frames covered across pages.
 * Labels: "1. 1.0s", "2. 3.0s", etc.
 * Returns array of written file paths.
 */
export async function createSnapshotContactSheet(
  snapshotsDir: string,
  outputPath: string,
): Promise<string[]> {
  if (!existsSync(snapshotsDir)) return [];

  const snapshotFiles = readdirSync(snapshotsDir)
    .filter((f) => f.startsWith("frame-") && f.endsWith(".png"))
    .sort();

  if (snapshotFiles.length === 0) return [];

  const paths = snapshotFiles.map((f) => join(snapshotsDir, f));
  const labels = snapshotFiles.map((f) => {
    const m = f.match(/at-([\d.]+)s/);
    return m ? `${m[1]}s` : f;
  });

  // 3 cols, 9 per page (3×3)
  return createContactSheetPages(
    paths,
    outputPath,
    { cols: 3, cellWidth: 600, pageSize: 9 },
    0,
    labels,
  );
}

/**
 * Contact sheet for captured assets. Paginated — all assets covered.
 * Labels: "1. filename"
 * Returns array of written file paths.
 */
export async function createAssetContactSheet(
  assetsDir: string,
  outputPath: string,
): Promise<string[]> {
  if (!existsSync(assetsDir)) return [];

  const imageExts = new Set([".png", ".jpg", ".jpeg", ".webp"]);
  const assetFiles = readdirSync(assetsDir)
    .filter((f) => imageExts.has(extname(f).toLowerCase()) && !f.includes("contact-sheet"))
    .sort();

  if (assetFiles.length === 0) return [];

  const paths = assetFiles.map((f) => join(assetsDir, f));

  // 4 cols, 12 per page (4×3) — covers all assets across as many pages as needed
  return createContactSheetPages(paths, outputPath, {
    cols: 4,
    cellWidth: 480,
    labelMode: "filename",
    pageSize: 12,
  });
}

/**
 * Contact sheet for SVGs — renders each SVG to a thumbnail PNG, then grids them.
 * Sharp supports SVG input natively, so no browser needed.
 * Labels: "1. filename"
 *
 * Accepts one or two directories: the primary svgs/ subdir and optionally the
 * parent assets/ root (for external SVGs downloaded as <img src="*.svg">).
 * Files are deduplicated by basename so duplicates across dirs are collapsed.
 */
// fallow-ignore-next-line complexity
export async function createSvgContactSheet(
  svgsDir: string,
  outputPath: string,
  assetsRootDir?: string,
): Promise<string[]> {
  const dirsToScan = [svgsDir, assetsRootDir].filter(
    (d): d is string => d !== undefined && existsSync(d),
  );
  if (dirsToScan.length === 0) return [];

  const seen = new Set<string>();
  const svgPaths: string[] = [];

  for (const dir of dirsToScan) {
    for (const f of readdirSync(dir)
      .filter((f) => f.endsWith(".svg"))
      .sort()) {
      if (!seen.has(f)) {
        seen.add(f);
        svgPaths.push(join(dir, f));
      }
    }
  }

  if (svgPaths.length === 0) return [];

  const svgFileNames = svgPaths.map((p) => p.split("/").pop()!);

  // Render ALL SVGs to PNG thumbnails first, then paginate the sheets
  const thumbSize = 200;
  const tmpDir = dirname(outputPath);
  const tmpPaths: string[] = [];
  const labels: string[] = [];

  for (let i = 0; i < svgPaths.length; i++) {
    const svgPath = svgPaths[i]!;
    const tmpPath = join(tmpDir, `.thumb-${i}.png`);
    try {
      const svgBuf = readFileSync(svgPath);
      const thumb = await sharp(svgBuf)
        .resize(thumbSize, thumbSize, {
          fit: "contain",
          background: { r: 245, g: 245, b: 245, alpha: 1 },
        })
        .flatten({ background: { r: 245, g: 245, b: 245 } })
        .png()
        .toBuffer();
      writeFileSync(tmpPath, thumb);
      tmpPaths.push(tmpPath);
      labels.push(svgFileNames[i]!.replace(".svg", ""));
    } catch {
      // SVG might be malformed — skip
    }
  }

  if (tmpPaths.length === 0) return [];

  // 5 cols, 15 per page (5×3) — all SVGs covered across pages
  let results: string[] = [];
  try {
    results = await createContactSheetPages(
      tmpPaths,
      outputPath,
      {
        cols: 5,
        cellWidth: thumbSize,
        pageSize: 15,
      },
      0,
      labels,
    );
  } finally {
    for (const tmp of tmpPaths) {
      try {
        unlinkSync(tmp);
      } catch {
        /* best effort */
      }
    }
  }

  return results;
}
