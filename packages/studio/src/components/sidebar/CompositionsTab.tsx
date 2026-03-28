import { memo, useRef, useState, useCallback, useEffect } from "react";
import { ExpandOnHover } from "../ui/ExpandOnHover";

interface CompositionsTabProps {
  projectId: string;
  compositions: string[];
  activeComposition: string | null;
  onSelect: (comp: string) => void;
}

function ExpandedCompPreview({
  previewUrl,
  name,
  comp,
  onSelect,
}: {
  previewUrl: string;
  name: string;
  comp: string;
  onSelect: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [dims, setDims] = useState({ w: 1920, h: 1080 });
  const [scale, setScale] = useState(1);

  const updateScale = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const s = Math.min(el.clientWidth / dims.w, el.clientHeight / dims.h);
    setScale(s);
  }, [dims]);

  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    updateScale();
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(updateScale);
    ro.observe(el);
    return () => ro.disconnect();
  }, [updateScale]);

  const handleLoad = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    // Detect dimensions from composition
    try {
      const doc = iframe.contentDocument;
      if (doc) {
        const root = doc.querySelector("[data-composition-id]");
        if (root) {
          const w = parseInt(root.getAttribute("data-width") ?? "0", 10);
          const h = parseInt(root.getAttribute("data-height") ?? "0", 10);
          if (w > 0 && h > 0) setDims({ w, h });
        }
      }
    } catch {
      /* cross-origin */
    }

    let attempts = 0;
    const interval = setInterval(() => {
      try {
        const win = iframe.contentWindow as Window & {
          __player?: { play: () => void; seek: (t: number) => void };
          __timelines?: Record<string, { play: () => void; seek: (t: number) => void }>;
        };
        if (win?.__player) {
          win.__player.seek(0.5);
          win.__player.play();
          clearInterval(interval);
          return;
        }
        if (win?.__timelines) {
          const keys = Object.keys(win.__timelines);
          const tl = keys.length > 0 ? win.__timelines[keys[keys.length - 1]] : null;
          if (tl) {
            tl.seek(0.5);
            tl.play();
            clearInterval(interval);
          }
        }
      } catch {
        /* cross-origin */
      }
      if (++attempts > 15) clearInterval(interval);
    }, 200);
  }, []);

  const offsetX = containerRef.current
    ? (containerRef.current.clientWidth - dims.w * scale) / 2
    : 0;
  const offsetY = containerRef.current
    ? (containerRef.current.clientHeight - dims.h * scale) / 2
    : 0;

  return (
    <div className="w-full h-full bg-neutral-950 rounded-[16px] overflow-hidden flex flex-col">
      <div ref={containerRef} className="flex-1 min-h-0 relative overflow-hidden bg-black">
        <iframe
          ref={iframeRef}
          src={previewUrl}
          sandbox="allow-scripts allow-same-origin"
          onLoad={handleLoad}
          className="absolute border-none"
          style={{
            left: Math.max(0, offsetX),
            top: Math.max(0, offsetY),
            width: dims.w,
            height: dims.h,
            transformOrigin: "0 0",
            transform: `scale(${scale})`,
          }}
          tabIndex={-1}
        />
      </div>
      <div className="px-5 py-3 bg-neutral-900 border-t border-neutral-800/50 flex items-center justify-between flex-shrink-0">
        <div>
          <div className="text-sm font-medium text-neutral-200">{name}</div>
          <div className="text-[10px] text-neutral-600 font-mono mt-0.5">{comp}</div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
          className="px-4 py-1.5 text-xs font-semibold text-[#09090B] bg-[#3CE6AC] rounded-lg hover:brightness-110 transition-colors"
        >
          Open
        </button>
      </div>
    </div>
  );
}

function CompCard({
  projectId,
  comp,
  isActive,
  onSelect,
}: {
  projectId: string;
  comp: string;
  isActive: boolean;
  onSelect: () => void;
}) {
  const name = comp.replace(/^compositions\//, "").replace(/\.html$/, "");
  const thumbnailUrl = `/api/projects/${projectId}/thumbnail/${comp}?t=0.5`;
  const previewUrl = `/api/projects/${projectId}/preview/comp/${comp}`;

  const card = (
    <div
      className={`w-full text-left px-2 py-1.5 flex items-center gap-2.5 transition-colors cursor-pointer ${
        isActive
          ? "bg-[#3CE6AC]/10 border-l-2 border-[#3CE6AC]"
          : "border-l-2 border-transparent hover:bg-neutral-800/50"
      }`}
    >
      <div className="w-20 h-[45px] rounded overflow-hidden bg-neutral-900 flex-shrink-0">
        <img
          src={thumbnailUrl}
          alt={name}
          loading="lazy"
          className="w-full h-full object-cover"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      </div>
      <div className="min-w-0 flex-1">
        <span className="text-[11px] font-medium text-neutral-300 truncate block">{name}</span>
        <span className="text-[9px] text-neutral-600 truncate block">{comp}</span>
      </div>
    </div>
  );

  return (
    <ExpandOnHover
      expandedContent={(closeExpand) => (
        <ExpandedCompPreview
          previewUrl={previewUrl}
          name={name}
          comp={comp}
          onSelect={() => {
            closeExpand();
            onSelect();
          }}
        />
      )}
      onClick={onSelect}
      expandScale={0.5}
      delay={500}
    >
      {card}
    </ExpandOnHover>
  );
}

export const CompositionsTab = memo(function CompositionsTab({
  projectId,
  compositions,
  activeComposition,
  onSelect,
}: CompositionsTabProps) {
  if (compositions.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <p className="text-xs text-neutral-600 text-center">No compositions found</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {compositions.map((comp) => (
        <CompCard
          key={comp}
          projectId={projectId}
          comp={comp}
          isActive={activeComposition === comp}
          onSelect={() => onSelect(comp)}
        />
      ))}
    </div>
  );
});
