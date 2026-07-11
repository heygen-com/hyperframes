/**
 * CapCut-style asset preview overlay rendered inside PreviewPane.
 *
 * Shown when the user clicks an asset card that has NOT yet been added to the
 * timeline. Displays the media (image / video / audio) without modifying the
 * composition — no undo entry, no file mutation.
 *
 * Dismiss: X button, Escape key, or click on the scrim.
 * Switching to another not-added asset replaces the current preview.
 */
import { useEffect, useCallback } from "react";
import { VIDEO_EXT, IMAGE_EXT } from "../../utils/mediaTypes";
import { useAssetPreviewStore } from "../../utils/assetPreviewStore";
import { resolveMediaPreviewUrl } from "../../player/components/thumbnailUtils";

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

type AssetKind = "image" | "video" | "audio";

function resolveAssetKind(path: string): AssetKind {
  if (VIDEO_EXT.test(path)) return "video";
  if (IMAGE_EXT.test(path)) return "image";
  return "audio";
}

/** The media element for a previewed asset, chosen by kind. */
function AssetPreviewMedia({
  kind,
  serveUrl,
  name,
}: {
  kind: AssetKind;
  serveUrl: string;
  name: string;
}) {
  if (kind === "image") {
    return (
      <img
        src={serveUrl}
        alt={name}
        className="max-w-full max-h-[70vh] rounded-md object-contain shadow-2xl"
      />
    );
  }
  if (kind === "video") {
    return (
      <video
        src={serveUrl}
        controls
        autoPlay
        muted
        playsInline
        className="max-w-full max-h-[70vh] rounded-md shadow-2xl"
      />
    );
  }
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-8 rounded-xl bg-neutral-900 border border-neutral-800">
      <svg
        width="40"
        height="40"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-neutral-500"
      >
        <path d="M9 18V5l12-2v13" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
      <audio src={serveUrl} controls className="w-64" />
    </div>
  );
}

export function AssetPreviewOverlay() {
  const previewAsset = useAssetPreviewStore((s) => s.previewAsset);
  const previewProjectId = useAssetPreviewStore((s) => s.previewProjectId);
  const clearPreviewAsset = useAssetPreviewStore((s) => s.clearPreviewAsset);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") clearPreviewAsset();
    },
    [clearPreviewAsset],
  );

  useEffect(() => {
    if (!previewAsset) return;
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewAsset, handleKeyDown]);

  if (!previewAsset || !previewProjectId) return null;

  const serveUrl = resolveMediaPreviewUrl(previewAsset, previewProjectId);
  const name = basename(previewAsset);

  return (
    <div
      className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/80"
      onClick={clearPreviewAsset}
      role="dialog"
      aria-label={`Preview: ${name}`}
      aria-modal="true"
    >
      {/* Close button */}
      <button
        className="absolute top-3 right-3 w-7 h-7 rounded-full bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white flex items-center justify-center transition-colors z-10"
        onClick={(e) => {
          e.stopPropagation();
          clearPreviewAsset();
        }}
        aria-label="Close preview"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2.5"
          fill="none"
          strokeLinecap="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      {/* Media */}
      <div
        className="flex flex-col items-center gap-3 max-w-[90%] max-h-[85%]"
        onClick={(e) => e.stopPropagation()}
      >
        <AssetPreviewMedia kind={resolveAssetKind(previewAsset)} serveUrl={serveUrl} name={name} />

        {/* Filename label */}
        <span className="text-[12px] text-neutral-400 truncate max-w-full px-2 text-center">
          {name}
        </span>
      </div>
    </div>
  );
}
