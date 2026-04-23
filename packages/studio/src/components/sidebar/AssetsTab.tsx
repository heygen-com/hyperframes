import { memo, useState, useCallback, useRef } from "react";
import { VideoFrameThumbnail } from "../ui/VideoFrameThumbnail";
import { MEDIA_EXT, IMAGE_EXT, VIDEO_EXT, AUDIO_EXT } from "../../utils/mediaTypes";
import { TIMELINE_ASSET_MIME } from "../../utils/timelineAssetDrop";

interface AssetsTabProps {
  projectId: string;
  assets: string[];
  onImport?: (files: FileList) => void;
  onDelete?: (path: string) => void;
  onRename?: (oldPath: string, newPath: string) => void;
}

/** Inline thumbnail content — rendered inside the container div in AssetCard. */
function AssetThumbnail({
  serveUrl,
  name,
  isImage,
  isVideo,
  isAudio,
}: {
  serveUrl: string;
  name: string;
  isImage: boolean;
  isVideo: boolean;
  isAudio: boolean;
}) {
  return (
    <>
      {isImage && (
        <img
          src={serveUrl}
          alt={name}
          loading="lazy"
          className="w-full h-full object-contain"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      )}
      {isVideo && <VideoFrameThumbnail src={serveUrl} />}
      {isAudio && (
        <div className="w-full h-full flex items-center justify-center">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-purple-400"
          >
            <path d="M9 18V5l12-2v13" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
        </div>
      )}
      {!isImage && !isVideo && !isAudio && (
        <div className="w-full h-full flex items-center justify-center">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-neutral-600"
          >
            <path
              d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <polyline points="14 2 14 8 20 8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}
    </>
  );
}

function AssetCard({
  projectId,
  asset,
  onCopy,
  isCopied,
  onDelete,
  onRename,
}: {
  projectId: string;
  asset: string;
  onCopy: (path: string) => void;
  isCopied: boolean;
  onDelete?: (path: string) => void;
  onRename?: (oldPath: string, newPath: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const name = asset.split("/").pop() ?? asset;
  const serveUrl = `/api/projects/${projectId}/preview/${asset}`;
  const isVideo = VIDEO_EXT.test(asset);

  return (
    <>
      <div
        draggable
        onClick={() => onCopy(asset)}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "copy";
          e.dataTransfer.setData(TIMELINE_ASSET_MIME, JSON.stringify({ path: asset }));
          e.dataTransfer.setData("text/plain", asset);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({ x: e.clientX, y: e.clientY });
        }}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        className={`w-full text-left px-2 py-1.5 flex items-center gap-2.5 transition-colors cursor-pointer ${
          isCopied
            ? "bg-studio-accent/10 border-l-2 border-studio-accent"
            : "border-l-2 border-transparent hover:bg-neutral-800/50"
        }`}
      >
        <div className="w-16 h-10 rounded overflow-hidden bg-neutral-900 flex-shrink-0 relative">
          <AssetThumbnail
            serveUrl={serveUrl}
            name={name}
            isImage={IMAGE_EXT.test(asset)}
            isVideo={isVideo}
            isAudio={AUDIO_EXT.test(asset)}
          />
          {isVideo && hovered && (
            <video
              src={serveUrl}
              autoPlay
              muted
              loop
              playsInline
              className="absolute inset-0 w-full h-full object-contain"
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          {renaming ? (
            <input
              autoFocus
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const trimmed = renameName.trim();
                  if (trimmed && trimmed !== name) {
                    const dir = asset.includes("/")
                      ? asset.slice(0, asset.lastIndexOf("/") + 1)
                      : "";
                    onRename?.(asset, dir + trimmed);
                  }
                  setRenaming(false);
                } else if (e.key === "Escape") {
                  setRenaming(false);
                }
              }}
              onBlur={() => {
                const trimmed = renameName.trim();
                if (trimmed && trimmed !== name) {
                  const dir = asset.includes("/") ? asset.slice(0, asset.lastIndexOf("/") + 1) : "";
                  onRename?.(asset, dir + trimmed);
                }
                setRenaming(false);
              }}
              onClick={(e) => e.stopPropagation()}
              className="w-full bg-neutral-800 text-neutral-200 text-[11px] px-1.5 py-0.5 rounded border border-neutral-600 outline-none focus:border-studio-accent"
              spellCheck={false}
            />
          ) : (
            <>
              <span className="text-[11px] font-medium text-neutral-300 truncate block">
                {name}
              </span>
              {isCopied ? (
                <span className="text-[9px] text-studio-accent">Copied!</span>
              ) : (
                <span className="text-[9px] text-neutral-600 truncate block">{asset}</span>
              )}
            </>
          )}
        </div>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed inset-0 z-[200]"
          onClick={() => setContextMenu(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            setContextMenu(null);
          }}
        >
          <div
            className="absolute bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl py-1 min-w-[140px] text-xs"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCopy(asset);
                setContextMenu(null);
              }}
              className="w-full text-left px-3 py-1.5 text-neutral-300 hover:bg-neutral-800 transition-colors"
            >
              Copy path
            </button>
            {onRename && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setRenameName(name);
                  setRenaming(true);
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 text-neutral-300 hover:bg-neutral-800 transition-colors"
              >
                Rename
              </button>
            )}
            {onDelete && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDelete(true);
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 text-red-400 hover:bg-neutral-800 transition-colors"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="px-2 py-1.5 bg-red-950/30 border-l-2 border-red-500 flex items-center justify-between gap-2">
          <span className="text-[10px] text-red-400 truncate">Delete {name}?</span>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete?.(asset);
                setConfirmDelete(false);
              }}
              className="px-2 py-0.5 text-[10px] rounded bg-red-600 text-white hover:bg-red-500 transition-colors"
            >
              Delete
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setConfirmDelete(false);
              }}
              className="px-2 py-0.5 text-[10px] rounded text-neutral-400 hover:text-neutral-200 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export const AssetsTab = memo(function AssetsTab({
  projectId,
  assets,
  onImport,
  onDelete,
  onRename,
}: AssetsTabProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length) onImport?.(e.dataTransfer.files);
    },
    [onImport],
  );

  const handleCopyPath = useCallback(async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setCopiedPath(path);
      setTimeout(() => setCopiedPath(null), 1500);
    } catch {
      // ignore
    }
  }, []);

  const mediaAssets = assets.filter((a) => MEDIA_EXT.test(a));

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
      {/* Import button */}
      {onImport && (
        <div className="px-3 py-2 border-b border-neutral-800/40 flex-shrink-0">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-[11px] rounded-lg border border-dashed border-neutral-700/50 text-neutral-500 hover:text-neutral-300 hover:border-neutral-600 transition-colors"
          >
            <svg
              width="12"
              height="12"
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
            accept="video/*,image/*,audio/*"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) {
                onImport(e.target.files);
                e.target.value = "";
              }
            }}
          />
        </div>
      )}

      {/* Asset list */}
      <div className="flex-1 overflow-y-auto">
        {mediaAssets.length === 0 ? (
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
          mediaAssets.map((asset) => (
            <AssetCard
              key={asset}
              projectId={projectId}
              asset={asset}
              onCopy={handleCopyPath}
              isCopied={copiedPath === asset}
              onDelete={onDelete}
              onRename={onRename}
            />
          ))
        )}
      </div>
    </div>
  );
});
