import { memo, useState, useCallback, useRef } from "react";
import { ExpandOnHover } from "../ui/ExpandOnHover";

interface AssetsTabProps {
  projectId: string;
  assets: string[];
  onImport?: (files: FileList) => void;
}

const MEDIA_EXT = /\.(mp4|webm|mov|mp3|wav|ogg|m4a|jpg|jpeg|png|gif|webp|svg)$/i;
const IMAGE_EXT = /\.(jpg|jpeg|png|gif|webp|svg)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov)$/i;
const AUDIO_EXT = /\.(mp3|wav|ogg|m4a)$/i;

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
    <div className="w-16 h-10 rounded overflow-hidden bg-neutral-900 flex-shrink-0 relative">
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
          <video
            src={serveUrl}
            muted
            playsInline
            preload="metadata"
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="white" className="opacity-80">
              <polygon points="6,3 20,12 6,21" />
            </svg>
          </div>
        </>
      )}
      {isAudio && (
        <div className="w-full h-full flex items-center justify-center bg-neutral-900">
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
        <div className="w-full h-full flex items-center justify-center bg-neutral-900">
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
    </div>
  );
}

function ExpandedAssetPreview({
  serveUrl,
  name,
  asset,
  isImage,
  isVideo,
  isAudio,
  onCopy,
}: {
  serveUrl: string;
  name: string;
  asset: string;
  isImage: boolean;
  isVideo: boolean;
  isAudio: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="w-full h-full bg-neutral-950 rounded-[16px] overflow-hidden flex flex-col">
      <div className="flex-1 min-h-0 flex items-center justify-center bg-black p-4">
        {isImage && (
          <img src={serveUrl} alt={name} className="max-w-full max-h-full object-contain rounded" />
        )}
        {isVideo && (
          <video
            src={serveUrl}
            autoPlay
            muted
            loop
            playsInline
            className="max-w-full max-h-full object-contain rounded"
          />
        )}
        {isAudio && (
          <div className="flex flex-col items-center gap-4">
            <svg
              width="48"
              height="48"
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
            <audio src={serveUrl} controls autoPlay className="w-64" />
          </div>
        )}
      </div>
      <div className="px-5 py-3 bg-neutral-900 border-t border-neutral-800/50 flex items-center justify-between flex-shrink-0">
        <div>
          <div className="text-sm font-medium text-neutral-200">{name}</div>
          <div className="text-[10px] text-neutral-600 font-mono mt-0.5">{asset}</div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onCopy();
          }}
          className="px-4 py-1.5 text-xs font-semibold text-[#09090B] bg-[#3CE6AC] rounded-lg hover:brightness-110 transition-colors"
        >
          Copy Path
        </button>
      </div>
    </div>
  );
}

function AssetCard({
  projectId,
  asset,
  onCopy,
  isCopied,
}: {
  projectId: string;
  asset: string;
  onCopy: (path: string) => void;
  isCopied: boolean;
}) {
  const name = asset.split("/").pop() ?? asset;
  const serveUrl = `/api/projects/${projectId}/preview/${asset}`;
  const isImage = IMAGE_EXT.test(asset);
  const isVideo = VIDEO_EXT.test(asset);
  const isAudio = AUDIO_EXT.test(asset);
  const hasExpandablePreview = isImage || isVideo || isAudio;

  const card = (
    <div
      className={`w-full text-left px-2 py-1.5 flex items-center gap-2.5 transition-colors cursor-pointer ${
        isCopied
          ? "bg-[#3CE6AC]/10 border-l-2 border-[#3CE6AC]"
          : "border-l-2 border-transparent hover:bg-neutral-800/50"
      }`}
    >
      <AssetThumbnail
        serveUrl={serveUrl}
        name={name}
        isImage={isImage}
        isVideo={isVideo}
        isAudio={isAudio}
      />
      <div className="min-w-0 flex-1">
        <span className="text-[11px] font-medium text-neutral-300 truncate block">{name}</span>
        {isCopied ? (
          <span className="text-[9px] text-[#3CE6AC]">Copied!</span>
        ) : (
          <span className="text-[9px] text-neutral-600 truncate block">{asset}</span>
        )}
      </div>
    </div>
  );

  if (!hasExpandablePreview) {
    return (
      <button
        type="button"
        onClick={() => onCopy(asset)}
        title="Click to copy path"
        className="w-full"
      >
        {card}
      </button>
    );
  }

  return (
    <ExpandOnHover
      expandedContent={(closeExpand) => (
        <ExpandedAssetPreview
          serveUrl={serveUrl}
          name={name}
          asset={asset}
          isImage={isImage}
          isVideo={isVideo}
          isAudio={isAudio}
          onCopy={() => {
            closeExpand();
            onCopy(asset);
          }}
        />
      )}
      onClick={() => onCopy(asset)}
      expandScale={0.45}
      delay={500}
    >
      {card}
    </ExpandOnHover>
  );
}

export const AssetsTab = memo(function AssetsTab({ projectId, assets, onImport }: AssetsTabProps) {
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
      className={`flex-1 flex flex-col min-h-0 transition-colors ${dragOver ? "bg-blue-950/20" : ""}`}
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
            />
          ))
        )}
      </div>
    </div>
  );
});
