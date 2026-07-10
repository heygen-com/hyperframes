// fallow-ignore-file code-duplication
import { memo, useState, useCallback, useRef, useMemo, useEffect } from "react";
import { VideoFrameThumbnail } from "../ui/VideoFrameThumbnail";
import { MEDIA_EXT, IMAGE_EXT, VIDEO_EXT, FONT_EXT } from "../../utils/mediaTypes";
import { TIMELINE_ASSET_MIME } from "../../utils/timelineAssetDrop";
import { beginDragSession, endDragSession } from "../../utils/dragSession";
import { copyTextToClipboard } from "../../utils/clipboard";
import { ContextMenu } from "./AssetContextMenu";
import { usePlayerStore } from "../../player/store/playerStore";
import {
  type MediaCategory,
  getCategory,
  basename,
  ext,
  CATEGORY_LABELS,
  FILTER_ORDER,
} from "./assetHelpers";
import { AudioRow } from "./AudioRow";
import { GlobalAssetsView } from "./GlobalAssetsView";

/**
 * Truncate a string to at most `maxLen` chars, preserving the start and end.
 * Middle characters are replaced with an ellipsis. If the string is short
 * enough it is returned unchanged.
 *
 * @example truncateMiddle("2a37eabf-long-uuid-887d8.mp4", 20) → "2a37eabf-…887d8.mp4"
 *
 * Pure — unit-tested.
 */
export function truncateMiddle(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  const keep = maxLen - 1; // 1 char for ellipsis
  const tail = Math.floor(keep / 3);
  const head = keep - tail;
  return str.slice(0, head) + "…" + str.slice(str.length - tail);
}

/**
 * Format a duration in seconds as MM:SS. Returns an empty string for
 * non-positive, NaN, or Infinity values. Pure — unit-tested.
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

interface AssetsTabProps {
  projectId: string;
  assets: string[];
  onImport?: (files: FileList) => void;
  onDelete?: (path: string) => void;
  onRename?: (oldPath: string, newPath: string) => void;
  onAddAssetToTimeline?: (path: string) => void;
}

/**
 * Lazily probe a video/audio URL for its duration via a hidden HTMLVideoElement
 * (`preload="metadata"`). The manifest only covers ~/.media assets, so project
 * assets in assets/ have no manifest entry — this fills the gap.
 * Returns `undefined` until the probe completes; `null` if it failed.
 * Pure side-effect: creates one hidden element per call, cleaned up on unmount.
 */
function useProbedDuration(src: string, skip: boolean): number | null | undefined {
  const [duration, setDuration] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    if (skip) return;
    let cancelled = false;

    function probe(attempt: number) {
      if (cancelled) return;
      const vid = document.createElement("video");
      vid.preload = "metadata";
      vid.muted = true;
      vid.onloadedmetadata = () => {
        const d = Number.isFinite(vid.duration) && vid.duration > 0 ? vid.duration : null;
        if (!cancelled) setDuration(d);
        vid.onloadedmetadata = null;
        vid.onerror = null;
        vid.src = "";
      };
      vid.onerror = () => {
        vid.onloadedmetadata = null;
        vid.onerror = null;
        vid.src = "";
        if (!cancelled) {
          // Retry once after a short delay — React 18 StrictMode's synchronous
          // cleanup can abort the first attempt; a second attempt succeeds.
          if (attempt < 1) setTimeout(() => probe(attempt + 1), 50);
          else setDuration(null);
        }
      };
      vid.src = src;
    }

    probe(0);
    return () => {
      cancelled = true;
    };
  }, [src, skip]);
  return duration;
}

/**
 * Thumbnail card for images and video assets. Renders in a 2-col grid.
 * Layout:
 *   - Rounded thumbnail that fills the card; video previews show a poster
 *     frame (VideoFrameThumbnail) + hover-preview video overlay.
 *   - "Added" dark chip badge top-left when the asset is used in the timeline.
 *   - Duration badge top-right for media with a known duration (MM:SS).
 *   - Filename caption below the card, truncated in the middle.
 */
// fallow-ignore-next-line complexity
function AssetCard({
  projectId,
  asset,
  used,
  duration,
  onCopy,
  isCopied,
  onDelete,
  onRename,
  onAddAssetToTimeline,
}: {
  projectId: string;
  asset: string;
  used: boolean;
  duration?: number;
  onCopy: (path: string) => void;
  isCopied: boolean;
  onDelete?: (path: string) => void;
  onRename?: (oldPath: string, newPath: string) => void;
  onAddAssetToTimeline?: (path: string) => void;
}) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [hovered, setHovered] = useState(false);
  const fullName = asset.split("/").pop() ?? asset; // filename with extension
  const name = basename(asset);
  const extension = ext(asset);
  const serveUrl = `/api/projects/${projectId}/preview/${asset}`;
  const isVideo = VIDEO_EXT.test(asset);
  const isImage = IMAGE_EXT.test(asset);
  // Lazily probe video duration when the manifest didn't supply one.
  // Skip for images (no duration) and when the manifest already provided it.
  const probedDuration = useProbedDuration(serveUrl, !isVideo || duration != null);
  const resolvedDuration = duration ?? probedDuration ?? undefined;
  const durationLabel = formatDuration(resolvedDuration ?? 0);

  return (
    <>
      <div
        draggable
        onClick={() => onCopy(asset)}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "copy";
          e.dataTransfer.setData(TIMELINE_ASSET_MIME, JSON.stringify({ path: asset }));
          e.dataTransfer.setData("text/plain", asset);
          beginDragSession({
            source: "asset",
            path: asset,
            kind: isVideo ? "video" : "image",
            durationSec: duration ?? null,
            label: name,
          });
        }}
        onDragEnd={endDragSession}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({ x: e.clientX, y: e.clientY });
        }}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        className={`flex flex-col gap-1 cursor-pointer rounded-md p-1 transition-colors ${
          isCopied ? "bg-studio-accent/10" : "hover:bg-neutral-800/40"
        }`}
      >
        {/* Thumbnail */}
        <div className="w-full aspect-video rounded overflow-hidden bg-neutral-900 relative">
          {isImage && (
            <img
              src={serveUrl}
              alt={name}
              loading="lazy"
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          )}
          {isVideo && (
            <>
              <VideoFrameThumbnail src={serveUrl} />
              {hovered && (
                <video
                  src={serveUrl}
                  autoPlay
                  muted
                  loop
                  playsInline
                  className="absolute inset-0 w-full h-full object-cover"
                />
              )}
            </>
          )}
          {!isImage && !isVideo && (
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-[10px] font-medium text-neutral-600">{extension}</span>
            </div>
          )}

          {/* "Added" badge — top-left */}
          {used && (
            <span className="absolute top-1 left-1 text-[9px] font-semibold leading-none px-1.5 py-[3px] rounded bg-neutral-950/80 text-panel-text-1">
              Added
            </span>
          )}

          {/* Duration badge — top-right, media only */}
          {durationLabel && (
            <span className="absolute top-1 right-1 text-[9px] font-medium leading-none px-1.5 py-[3px] rounded bg-neutral-950/80 text-panel-text-2 tabular-nums">
              {durationLabel}
            </span>
          )}
        </div>

        {/* Filename caption */}
        <span
          className={`text-[10px] leading-tight text-center block w-full ${
            used ? "text-panel-text-2" : "text-panel-text-4"
          }`}
          title={fullName}
        >
          {truncateMiddle(fullName, 22)}
        </span>
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          asset={asset}
          onClose={() => setContextMenu(null)}
          onCopy={onCopy}
          onDelete={onDelete}
          onRename={onRename}
          onAddAtPlayhead={onAddAssetToTimeline}
        />
      )}
    </>
  );
}

/**
 * Compact row for font assets (no meaningful thumbnail; show ext badge + name).
 * Kept as a row rather than a card because font previews require font-loading
 * and an aspect-video thumbnail would just be empty.
 */
function FontRow({
  asset,
  used,
  onCopy,
  isCopied,
  onDelete,
  onRename,
  onAddAssetToTimeline,
}: {
  asset: string;
  used: boolean;
  onCopy: (path: string) => void;
  isCopied: boolean;
  onDelete?: (path: string) => void;
  onRename?: (oldPath: string, newPath: string) => void;
  onAddAssetToTimeline?: (path: string) => void;
}) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const name = basename(asset);
  const extension = ext(asset);

  return (
    <>
      <div
        draggable
        onClick={() => onCopy(asset)}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "copy";
          e.dataTransfer.setData(TIMELINE_ASSET_MIME, JSON.stringify({ path: asset }));
          e.dataTransfer.setData("text/plain", asset);
          beginDragSession({
            source: "asset",
            path: asset,
            kind: "image", // fonts treated as non-media for DnD kind
            durationSec: null,
            label: name,
          });
        }}
        onDragEnd={endDragSession}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({ x: e.clientX, y: e.clientY });
        }}
        className={`px-2.5 py-1.5 flex items-center gap-2.5 cursor-pointer transition-colors ${
          isCopied
            ? "bg-studio-accent/10 border-l-2 border-studio-accent"
            : "border-l-2 border-transparent hover:bg-neutral-800/50"
        }`}
      >
        <div className="w-[50px] h-[32px] rounded overflow-hidden bg-neutral-900 flex-shrink-0 flex items-center justify-center">
          <span className="text-[9px] font-medium text-neutral-700">{extension}</span>
        </div>
        <div className="min-w-0 flex-1">
          <span
            className={`text-xs font-medium truncate block ${used ? "text-panel-text-1" : "text-panel-text-3"}`}
          >
            {name}
          </span>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-neutral-600 truncate">{extension}</span>
            {used && (
              <span className="text-[9px] font-medium text-panel-accent bg-panel-accent/10 px-1.5 py-px rounded">
                in use
              </span>
            )}
          </div>
        </div>
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          asset={asset}
          onClose={() => setContextMenu(null)}
          onCopy={onCopy}
          onDelete={onDelete}
          onRename={onRename}
          onAddAtPlayhead={onAddAssetToTimeline}
        />
      )}
    </>
  );
}

export type UsageFilter = "all" | "used" | "unused";

/** Filter assets by whether the composition references them. Pure — unit-tested. */
export function filterByUsage(
  assets: string[],
  usedPaths: Set<string>,
  usageFilter: UsageFilter,
): string[] {
  if (usageFilter === "used") return assets.filter((a) => usedPaths.has(a));
  if (usageFilter === "unused") return assets.filter((a) => !usedPaths.has(a));
  return assets;
}

/** Count used vs unused over a media set. Pure — unit-tested. */
export function countUsage(
  assets: string[],
  usedPaths: Set<string>,
): { used: number; unused: number } {
  let used = 0;
  for (const a of assets) if (usedPaths.has(a)) used++;
  return { used, unused: assets.length - used };
}

/**
 * Project-relative asset paths referenced by composition elements — the set the
 * "in use" badge, used-first sort, and usage filter all key on. Element src is
 * populated from the core runtime's `resolveNodeAssetUrl` which calls
 * `new URL(raw, document.baseURI).toString()`, turning authored relative paths
 * into fully-absolute URLs with percent-encoded characters, e.g.
 *   "assets/my file (1).mp4"
 *   → "http://localhost:3012/api/projects/demo/preview/assets/my%20file%20(1).mp4"
 *
 * This function normalizes every src shape to the bare project-relative path so
 * it matches the asset-list entries:
 *   - Absolute URL  → strip origin + /api/projects/<id>/preview/ prefix, decode %XX
 *   - Server-relative /api/…preview/… → same strip + decode
 *   - Relative "./"-prefixed or bare → strip leading ./ or /
 *   - ?query / #hash → dropped
 *
 * Pure — unit-tested.
 */
export function deriveUsedPaths(elements: Array<{ src?: string }>): Set<string> {
  const paths = new Set<string>();
  for (const el of elements) {
    if (!el.src) continue;
    let s = el.src;

    // Strip absolute origin if present (http://host/path → /path)
    try {
      const u = new URL(s);
      s = u.pathname + (u.search ? u.search : "") + (u.hash ? u.hash : "");
    } catch {
      // Not a valid absolute URL — leave as-is (relative path)
    }

    s = s
      .replace(/^\/api\/projects\/[^/]+\/preview\//, "") // strip the dev serve prefix
      .replace(/^\.?\//, "") // strip leading ./ or /
      .split(/[?#]/)[0]; // drop query / hash

    // Decode percent-encoded characters (spaces, parens, etc.) so the path
    // matches the plain-text asset-list entries the server returns.
    try {
      s = decodeURIComponent(s);
    } catch {
      // Malformed encoding — use as-is
    }

    if (s) paths.add(s);
  }
  return paths;
}

export const AssetsTab = memo(function AssetsTab({
  projectId,
  assets,
  onImport,
  onDelete,
  onRename,
  onAddAssetToTimeline,
}: AssetsTabProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<MediaCategory | "all">("all");
  const [usageFilter, setUsageFilter] = useState<"all" | "used" | "unused">("all");
  const [searchQuery, setSearchQuery] = useState("");
  // Cross-project view: the global media-use cache (~/.media). The view itself
  // (GlobalAssetsView) owns its fetch — AssetsTab only tracks which scope is active.
  const [viewMode, setViewMode] = useState<"local" | "global">("local");
  const [manifest, setManifest] = useState<
    Map<string, { description?: string; duration?: number; width?: number; height?: number }>
  >(new Map());

  // Projects whose media manifest 404'd — most don't have one. Cache the miss so
  // we don't re-fetch (and spam the console) on every re-render; the effect was
  // also keyed on the `assets` array reference, which changes each render, so it
  // re-fired constantly. Key on a stable join + skip known-missing manifests.
  const manifest404Ref = useRef<Set<string>>(new Set());
  const assetsKey = assets.join("|");
  useEffect(() => {
    if (manifest404Ref.current.has(projectId)) return;
    let cancelled = false;
    fetch(`/api/projects/${projectId}/preview/.media/manifest.jsonl`)
      .then((r) => {
        if (!r.ok) {
          manifest404Ref.current.add(projectId);
          return "";
        }
        return r.text();
      })
      .then((text) => {
        if (cancelled || !text) return;
        const m = new Map<
          string,
          { description?: string; duration?: number; width?: number; height?: number }
        >();
        for (const line of text.split("\n")) {
          if (!line.trim()) continue;
          try {
            const rec = JSON.parse(line);
            if (rec.path) m.set(rec.path, rec);
          } catch {
            /* skip */
          }
        }
        setManifest(m);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId, assetsKey]);
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length) onImport?.(e.dataTransfer.files);
    },
    [onImport],
  );
  const handleCopyPath = useCallback(async (path: string) => {
    const copied = await copyTextToClipboard(path);
    if (copied) {
      setCopiedPath(path);
      setTimeout(() => setCopiedPath(null), 1500);
    }
  }, []);
  const elements = usePlayerStore((s) => s.elements);
  const usedPaths = useMemo(() => deriveUsedPaths(elements), [elements]);
  const mediaAssets = useMemo(() => {
    const media = assets.filter((a) => MEDIA_EXT.test(a) || FONT_EXT.test(a));
    const all = filterByUsage(media, usedPaths, usageFilter);
    if (!searchQuery) return all;
    const q = searchQuery.toLowerCase();
    return all.filter((a) => {
      if (basename(a).toLowerCase().includes(q)) return true;
      const rec = manifest.get(a);
      return rec?.description?.toLowerCase().includes(q);
    });
  }, [assets, searchQuery, manifest, usageFilter, usedPaths]);
  const categorized = useMemo(() => {
    const groups: Record<MediaCategory, string[]> = { audio: [], images: [], video: [], fonts: [] };
    for (const a of mediaAssets) {
      const cat = getCategory(a);
      if (cat) groups[cat].push(a);
    }
    // Sort: used assets first within each category
    for (const cat of FILTER_ORDER) {
      groups[cat].sort((a, b) => {
        const aUsed = usedPaths.has(a) ? 0 : 1;
        const bUsed = usedPaths.has(b) ? 0 : 1;
        return aUsed - bUsed;
      });
    }
    return groups;
  }, [mediaAssets, usedPaths]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: mediaAssets.length };
    for (const cat of FILTER_ORDER) c[cat] = categorized[cat].length;
    return c;
  }, [mediaAssets, categorized]);
  // Usage counts over the full media set (independent of the active usage filter,
  // so the chips don't show their own filtered totals).
  const usageCounts = useMemo(
    () =>
      countUsage(
        assets.filter((a) => MEDIA_EXT.test(a) || FONT_EXT.test(a)),
        usedPaths,
      ),
    [assets, usedPaths],
  );
  const visibleCategories =
    activeFilter === "all"
      ? FILTER_ORDER.filter((c) => categorized[c].length > 0)
      : [activeFilter as MediaCategory].filter((c) => categorized[c].length > 0);
  return (
    <div
      className={`flex-1 flex flex-col min-h-0 transition-colors ${dragOver ? "bg-studio-accent/[0.05]" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {/* Header — matches design panel Section pattern */}
      <div className="px-4 pt-2.5 pb-1.5 flex-shrink-0">
        {/* Scope toggle — this project's assets vs the global media-use cache */}
        <div className="flex gap-1 mb-2.5 p-0.5 rounded-md bg-panel-input">
          {(["local", "global"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              className={`flex-1 px-2 py-1 text-[11px] font-medium rounded transition-colors ${
                viewMode === m
                  ? "bg-panel-accent/15 text-panel-accent"
                  : "text-panel-text-3 hover:text-panel-text-1"
              }`}
            >
              {m === "local" ? "This project" : "All projects"}
            </button>
          ))}
        </div>
        {/* Import */}
        {onImport && (
          <>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-1.5 rounded-md bg-panel-input px-3 py-[7px] text-[11px] font-medium text-panel-text-3 hover:text-panel-text-1 transition-colors mb-2.5"
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              Import media
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*,image/*,audio/*,font/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) {
                  onImport(e.target.files);
                  e.target.value = "";
                }
              }}
            />
          </>
        )}

        {/* Search */}
        {mediaAssets.length > 0 && (
          <div className="flex items-center gap-1.5 rounded-md bg-panel-input px-2.5 py-[5px] mb-2">
            <svg width="12" height="12" viewBox="0 0 256 256" fill="none" className="flex-shrink-0">
              <circle
                cx="116"
                cy="116"
                r="76"
                stroke="currentColor"
                strokeWidth="22"
                className="text-panel-text-5"
              />
              <line
                x1="170"
                y1="170"
                x2="232"
                y2="232"
                stroke="currentColor"
                strokeWidth="22"
                strokeLinecap="round"
                className="text-panel-text-5"
              />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search assets..."
              className="min-w-0 w-full bg-transparent text-[11px] text-panel-text-1 outline-none placeholder:text-panel-text-5"
            />
          </div>
        )}

        {/* Filter chips — panel-input style (local view only) */}
        {viewMode === "local" && mediaAssets.length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            <button
              onClick={() => setActiveFilter("all")}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
                activeFilter === "all"
                  ? "bg-panel-accent/15 text-panel-accent"
                  : "bg-panel-input text-panel-text-3 hover:text-panel-text-1"
              }`}
            >
              All {counts.all}
            </button>
            {FILTER_ORDER.map((cat) =>
              counts[cat] > 0 ? (
                <button
                  key={cat}
                  onClick={() => setActiveFilter(activeFilter === cat ? "all" : cat)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
                    activeFilter === cat
                      ? "bg-panel-accent/15 text-panel-accent"
                      : "bg-panel-input text-panel-text-3 hover:text-panel-text-1"
                  }`}
                >
                  {CATEGORY_LABELS[cat]} {counts[cat]}
                </button>
              ) : null,
            )}
            {/* Usage filter — show only assets the composition references, or only the unused ones */}
            {usageCounts.used > 0 && usageCounts.unused > 0 && (
              <>
                <span className="w-px self-stretch bg-panel-input mx-0.5" aria-hidden="true" />
                <button
                  onClick={() => setUsageFilter(usageFilter === "used" ? "all" : "used")}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
                    usageFilter === "used"
                      ? "bg-panel-accent/15 text-panel-accent"
                      : "bg-panel-input text-panel-text-3 hover:text-panel-text-1"
                  }`}
                >
                  In use {usageCounts.used}
                </button>
                <button
                  onClick={() => setUsageFilter(usageFilter === "unused" ? "all" : "unused")}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
                    usageFilter === "unused"
                      ? "bg-panel-accent/15 text-panel-accent"
                      : "bg-panel-input text-panel-text-3 hover:text-panel-text-1"
                  }`}
                >
                  Unused {usageCounts.unused}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto mt-1">
        {viewMode === "global" ? (
          <GlobalAssetsView searchQuery={searchQuery} />
        ) : mediaAssets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-4 gap-2">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-neutral-700"
            >
              <path
                d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <polyline points="17 8 12 3 7 8" strokeLinecap="round" strokeLinejoin="round" />
              <line x1="12" y1="3" x2="12" y2="15" strokeLinecap="round" />
            </svg>
            <p className="text-[10px] text-neutral-600 text-center">Drop media files here</p>
          </div>
        ) : (
          visibleCategories.map((cat) => (
            <div key={cat} className="mb-1">
              {activeFilter === "all" && (
                <div className="flex items-center gap-2 px-4 py-2 border-t border-panel-border">
                  <h3 className="text-[12px] font-semibold text-panel-text-1">
                    {CATEGORY_LABELS[cat]}
                  </h3>
                  <span className="text-[11px] text-panel-text-5">{categorized[cat].length}</span>
                </div>
              )}
              {cat === "audio" &&
                categorized[cat].map((a) => (
                  <AudioRow
                    key={a}
                    projectId={projectId}
                    asset={a}
                    used={usedPaths.has(a)}
                    meta={manifest.get(a)}
                    onCopy={handleCopyPath}
                    isCopied={copiedPath === a}
                    onDelete={onDelete}
                    onRename={onRename}
                    onAddAssetToTimeline={onAddAssetToTimeline}
                  />
                ))}
              {(cat === "images" || cat === "video") && (
                <div className="grid grid-cols-2 gap-1 px-2 pb-1">
                  {categorized[cat].map((a) => (
                    <AssetCard
                      key={a}
                      projectId={projectId}
                      asset={a}
                      used={usedPaths.has(a)}
                      duration={manifest.get(a)?.duration}
                      onCopy={handleCopyPath}
                      isCopied={copiedPath === a}
                      onDelete={onDelete}
                      onRename={onRename}
                      onAddAssetToTimeline={onAddAssetToTimeline}
                    />
                  ))}
                </div>
              )}
              {cat === "fonts" &&
                categorized[cat].map((a) => (
                  <FontRow
                    key={a}
                    asset={a}
                    used={usedPaths.has(a)}
                    onCopy={handleCopyPath}
                    isCopied={copiedPath === a}
                    onDelete={onDelete}
                    onRename={onRename}
                    onAddAssetToTimeline={onAddAssetToTimeline}
                  />
                ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
});
