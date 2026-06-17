import { createWriteStream, existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { c } from "../../ui/colors.js";
import { safeFetch } from "../../capture/assetDownloader.js";

const MAX_VIDEO_BYTES = 250 * 1024 * 1024;
const VIDEO_CONTENT_TYPE_RE = /^(video\/|application\/(mp4|octet-stream|x-mpegurl))/i;

// fallow-ignore-next-line complexity
async function streamToFile(url: string, destPath: string): Promise<number> {
  // safeFetch re-validates redirect hops; bare redirect:"follow" leaks to private hosts.
  const r = await safeFetch(url, {
    signal: AbortSignal.timeout(120_000),
    headers: { "User-Agent": "HyperFrames/1.0" },
  });
  if (!r) {
    throw new Error(
      `fetch blocked or failed (private/metadata host, redirect chain, or network error): ${url}`,
    );
  }
  if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText} for ${url}`);
  const ct = r.headers.get("content-type") || "";
  if (!VIDEO_CONTENT_TYPE_RE.test(ct)) {
    throw new Error(
      `unexpected content-type "${ct}" for ${url} — expected video/*. The URL probably doesn't point at a real video file.`,
    );
  }
  const cl = r.headers.get("content-length");
  if (cl && Number(cl) > MAX_VIDEO_BYTES) {
    throw new Error(
      `video too large (${Math.round(Number(cl) / 1024 / 1024)}MB > ${Math.round(MAX_VIDEO_BYTES / 1024 / 1024)}MB cap) for ${url}`,
    );
  }
  if (!r.body) throw new Error(`empty response body for ${url}`);

  // `flags: "wx"` = exclusive-create; throws EEXIST if destPath exists. Stream chunks
  // and abort mid-transfer if cumulative bytes exceed the cap so a hostile CDN can't
  // OOM the process by lying about content-length.
  const file = createWriteStream(destPath, { flags: "wx" });
  // Single shared error promise: avoids re-attaching `error` listeners per chunk (MaxListeners warning).
  let streamError: Error | null = null;
  const streamErrored = new Promise<never>((_, reject) => {
    file.once("error", (e) => {
      streamError = e;
      reject(e);
    });
  });
  let bytes = 0;
  try {
    await Promise.race([
      streamErrored,
      new Promise<void>((resolveOpen) => file.once("open", () => resolveOpen())),
    ]);
    for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
      if (streamError) throw streamError;
      bytes += chunk.byteLength;
      if (bytes > MAX_VIDEO_BYTES) {
        throw new Error(
          `video exceeded ${Math.round(MAX_VIDEO_BYTES / 1024 / 1024)}MB cap mid-stream for ${url}`,
        );
      }
      // lgtm[js/http-to-file-access] — manifest-vetted URL, content-type whitelist, 250MB cap with mid-stream abort, SSRF-safe fetch
      if (!file.write(chunk)) {
        await Promise.race([
          streamErrored,
          new Promise<void>((resolveDrain) => file.once("drain", () => resolveDrain())),
        ]);
      }
    }
    await new Promise<void>((resolveEnd, rejectEnd) => {
      file.end((err?: Error | null) => (err ? rejectEnd(err) : resolveEnd()));
    });
    return bytes;
  } catch (e) {
    file.destroy();
    // EEXIST means destPath ALREADY existed before we wrote anything — leave it alone.
    // Any other error means we created a partial file that the caller should not see.
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") {
      try {
        unlinkSync(destPath);
      } catch {
        /* partial file may not exist */
      }
    }
    throw e;
  }
}

export function safeFilename(name: string): string {
  let decoded = name;
  try {
    decoded = decodeURIComponent(name);
  } catch {
    /* malformed percent-encoding */
  }
  return decoded.replace(/[^A-Za-z0-9._-]+/g, "_");
}

export { VIDEO_CONTENT_TYPE_RE, MAX_VIDEO_BYTES };

export interface ManifestEntry {
  index: number;
  url: string;
  filename: string;
  width: number;
  height: number;
  heading: string;
  caption: string;
  ariaLabel: string;
  preview: string;
}

export type PickResult =
  | { ok: true; entry: ManifestEntry }
  | {
      ok: false;
      code: "no-selector" | "bad-index" | "no-match-index" | "no-match-url";
      message: string;
    };

// Two manifest entries can produce the same safeFilename (URL-encoded variants of the same name
// collapse after decode). The wx exclusive-create + EEXIST handler would silently misreport the
// second as "already downloaded" while serving the first's bytes. Fail loudly instead.
export function findFilenameCollision(
  manifest: ManifestEntry[],
  selected: ManifestEntry,
): ManifestEntry[] {
  const selectedName = safeFilename(selected.filename || basename(selected.url));
  return manifest.filter(
    (e) =>
      e.index !== selected.index && safeFilename(e.filename || basename(e.url)) === selectedName,
  );
}

// Looks up by `entry.index`, not array offset — captureVideoManifest leaves gaps when previews fail.
export function pickManifestEntry(
  manifest: ManifestEntry[],
  args: { index?: string | number | null; url?: string | null },
): PickResult {
  if (args.index != null) {
    const i = Number(args.index);
    if (!Number.isInteger(i) || i < 0) {
      return {
        ok: false,
        code: "bad-index",
        message: `--index ${args.index} must be a non-negative integer`,
      };
    }
    const found = manifest.find((e) => e.index === i);
    if (!found) {
      const available = manifest.map((e) => e.index).join(", ");
      return {
        ok: false,
        code: "no-match-index",
        message: `no manifest entry with index=${i} (available: ${available || "none"})`,
      };
    }
    return { ok: true, entry: found };
  }
  if (args.url != null) {
    const found = manifest.find((e) => e.url === args.url);
    if (!found) {
      return { ok: false, code: "no-match-url", message: `no manifest entry with url=${args.url}` };
    }
    return { ok: true, entry: found };
  }
  return {
    ok: false,
    code: "no-selector",
    message: "specify --index <N> or --url <URL> (or --list to see what's in the manifest)",
  };
}

export interface VideoModeArgs {
  project: string;
  index?: string | null;
  url?: string | null;
  list?: boolean;
}

// fallow-ignore-next-line complexity
export async function runVideoMode(args: VideoModeArgs): Promise<void> {
  const projectDir = resolve(args.project);
  // standalone capture writes `<dir>/extracted/…`; W2H project nests under `<dir>/capture/extracted/…`.
  const directPath = join(projectDir, "extracted", "video-manifest.json");
  const w2hPath = join(projectDir, "capture", "extracted", "video-manifest.json");
  const manifestPath = existsSync(directPath) ? directPath : w2hPath;
  const isW2hLayout = manifestPath === w2hPath;
  if (!existsSync(manifestPath)) {
    console.error(
      `${c.error("✗")} no video-manifest.json at ${directPath} or ${w2hPath}\n` +
        `  Was this directory produced by \`hyperframes capture\`?`,
    );
    process.exitCode = 1;
    return;
  }
  let manifest: ManifestEntry[];
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  } catch (e) {
    console.error(`${c.error("✗")} video-manifest.json is malformed: ${(e as Error).message}`);
    process.exitCode = 1;
    return;
  }

  if (args.list) {
    if (manifest.length === 0) {
      console.log(c.dim("(manifest is empty — no <video> elements on the captured page)"));
      return;
    }
    console.log(
      `${manifest.length} video entr${manifest.length === 1 ? "y" : "ies"} in ${manifestPath}:`,
    );
    for (const e of manifest) {
      console.log(
        `  ${c.bold(`[${e.index}]`)} ${e.filename} — ${e.width}×${e.height}` +
          (e.heading ? `\n      heading: "${e.heading}"` : "") +
          `\n      url: ${e.url}`,
      );
    }
    return;
  }

  const pick = pickManifestEntry(manifest, args);
  if (!pick.ok) {
    console.error(
      `${c.error("✗")} ${pick.message}` +
        (pick.code === "no-match-url" ? `\n  Run with --list to see what's available.` : ""),
    );
    process.exitCode = 1;
    return;
  }
  const entry = pick.entry;

  const collisions = findFilenameCollision(manifest, entry);
  if (collisions.length > 0) {
    console.error(
      `${c.error("✗")} filename "${safeFilename(entry.filename || basename(entry.url))}" ` +
        `collides with manifest entr${collisions.length === 1 ? "y" : "ies"} ` +
        `${collisions.map((co) => `[${co.index}]`).join(", ")}. ` +
        `Refusing to download — the on-disk file's bytes would not match the requested entry.`,
    );
    process.exitCode = 1;
    return;
  }

  const outDir = isW2hLayout
    ? join(projectDir, "capture", "assets", "videos")
    : join(projectDir, "assets", "videos");
  mkdirSync(outDir, { recursive: true });
  const fname = safeFilename(entry.filename || basename(entry.url));
  const outPath = join(outDir, fname);
  const relPath = isW2hLayout ? `capture/assets/videos/${fname}` : `assets/videos/${fname}`;

  console.log(
    `${c.accent("▸")} downloading [${entry.index}] ${entry.filename} (${entry.width}×${entry.height})`,
  );
  console.log(`     from: ${entry.url}`);
  try {
    const bytes = await streamToFile(entry.url, outPath);
    const sizeKb = Math.round(bytes / 1024);
    const sizeStr = sizeKb > 1024 ? `${(sizeKb / 1024).toFixed(1)}MB` : `${sizeKb}KB`;
    console.log(`${c.success("◇")}  wrote ${relPath} (${sizeStr})`);
    const snippetId = `video-${entry.index}`;
    console.log(
      `     Reference it from a beat composition as:\n` +
        `       <video id="${snippetId}" src="${relPath}" data-start="0" data-duration="${entry.width === entry.height ? 5 : 4}" data-track-index="0" autoplay muted loop></video>`,
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") {
      console.log(`${c.warn("⚠")}  already downloaded: ${relPath} (skipping)`);
      console.log(`     Delete the file and re-run to refetch.`);
      return;
    }
    console.error(`${c.error("✗")} download failed: ${(e as Error).message}`);
    process.exitCode = 1;
  }
}
