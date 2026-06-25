import { useState, useRef, useEffect, useCallback } from "react";
import { ContextMenu } from "./AssetContextMenu";
import { basename, getAudioSubtype } from "./assetHelpers";
import { TIMELINE_ASSET_MIME } from "../../utils/timelineAssetDrop";

export function AudioRow({
  projectId,
  asset,
  used,
  meta,
  onCopy,
  isCopied,
  onDelete,
  onRename,
}: {
  projectId: string;
  asset: string;
  used: boolean;
  meta?: { description?: string; duration?: number };
  onCopy: (path: string) => void;
  isCopied: boolean;
  onDelete?: (path: string) => void;
  onRename?: (oldPath: string, newPath: string) => void;
}) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [bars, setBars] = useState<number[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const actxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const animRef = useRef<number>(0);
  const name = basename(asset);
  const subtype = getAudioSubtype(asset);
  const serveUrl = `/api/projects/${projectId}/preview/${asset}`;

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animRef.current);
      audioRef.current?.pause();
      actxRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (playing) {
      const barCount = 24;
      const loop = () => {
        const analyser = analyserRef.current;
        if (!analyser) {
          animRef.current = requestAnimationFrame(loop);
          return;
        }
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        const step = Math.floor(data.length / barCount);
        const next: number[] = [];
        for (let i = 0; i < barCount; i++) {
          let sum = 0;
          for (let j = 0; j < step; j++) sum += data[i * step + j];
          next.push(sum / step / 255);
        }
        setBars(next);
        if (audioRef.current && !audioRef.current.paused)
          animRef.current = requestAnimationFrame(loop);
      };
      animRef.current = requestAnimationFrame(loop);
    } else {
      setBars([]);
    }
    return () => cancelAnimationFrame(animRef.current);
  }, [playing]);

  const togglePlay = useCallback(async () => {
    if (playing) {
      audioRef.current?.pause();
      setPlaying(false);
      cancelAnimationFrame(animRef.current);
      return;
    }

    if (!actxRef.current) {
      actxRef.current = new AudioContext();
      analyserRef.current = actxRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      analyserRef.current.smoothingTimeConstant = 0.7;
    }

    if (!audioRef.current) {
      const el = new Audio();
      el.onended = () => {
        setPlaying(false);
        cancelAnimationFrame(animRef.current);
      };
      audioRef.current = el;
      sourceRef.current = actxRef.current.createMediaElementSource(el);
      sourceRef.current.connect(analyserRef.current!);
      analyserRef.current!.connect(actxRef.current.destination);
      el.src = serveUrl;
    }

    if (actxRef.current.state === "suspended") await actxRef.current.resume();
    audioRef.current.currentTime = 0;
    await audioRef.current.play();
    setPlaying(true);
  }, [serveUrl, playing]);

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
        className={`group w-full text-left px-4 py-1.5 flex items-center gap-2.5 transition-all cursor-pointer ${
          playing
            ? "bg-panel-accent/[0.06]"
            : isCopied
              ? "bg-panel-accent/10"
              : "hover:bg-panel-surface-hover"
        }`}
      >
        <button
          className={`w-7 h-7 rounded-md flex-shrink-0 flex items-center justify-center transition-all ${
            playing
              ? "bg-panel-accent/15 text-panel-accent"
              : "text-panel-text-5 group-hover:text-panel-text-3"
          }`}
          onClick={(e) => {
            e.stopPropagation();
            togglePlay();
          }}
        >
          {playing ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="6,4 20,12 6,20" />
            </svg>
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className={`text-[12px] font-medium truncate ${used ? "text-panel-text-1" : "text-panel-text-3"}`}
            >
              {name}
            </span>
            {!playing && (
              <span className="text-[11px] text-panel-text-5 flex-shrink-0">
                {meta?.duration ? `${meta.duration}s · ` : ""}
                {subtype}
              </span>
            )}
            {used && (
              <span className="text-[9px] font-medium text-panel-accent bg-panel-accent/10 px-1.5 py-px rounded flex-shrink-0">
                in use
              </span>
            )}
          </div>
          {bars.length > 0 && (
            <div className="flex items-end gap-[2px] h-[14px] mt-0.5">
              {bars.map((v, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-[1px]"
                  style={{
                    height: `${Math.max(10, v * 100)}%`,
                    background: `linear-gradient(to top, rgba(60, 230, 172, ${0.3 + v * 0.5}), rgba(60, 230, 172, ${0.5 + v * 0.5}))`,
                    transition: "height 80ms ease-out",
                  }}
                />
              ))}
            </div>
          )}
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
        />
      )}
    </>
  );
}
