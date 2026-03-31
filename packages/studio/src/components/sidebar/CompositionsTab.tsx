import { memo, useRef, useState } from "react";

interface CompositionsTabProps {
  projectId: string;
  compositions: string[];
  activeComposition: string | null;
  onSelect: (comp: string) => void;
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
  const [hovered, setHovered] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleEnter = () => {
    hoverTimer.current = setTimeout(() => setHovered(true), 300);
  };
  const handleLeave = () => {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    setHovered(false);
  };
  const name = comp.replace(/^compositions\//, "").replace(/\.html$/, "");
  const thumbnailUrl = `/api/projects/${projectId}/thumbnail/${comp}?t=2`;
  const previewUrl = `/api/projects/${projectId}/preview/comp/${comp}`;

  return (
    <div
      onClick={onSelect}
      onPointerEnter={handleEnter}
      onPointerLeave={handleLeave}
      className={`w-full text-left px-2 py-1.5 flex items-center gap-2.5 transition-colors cursor-pointer ${
        isActive
          ? "bg-studio-accent/10 border-l-2 border-studio-accent"
          : "border-l-2 border-transparent hover:bg-neutral-800/50"
      }`}
    >
      <div className="w-20 h-[45px] rounded overflow-hidden bg-neutral-900 flex-shrink-0 relative">
        {/* Live iframe preview on hover */}
        {hovered && (
          <iframe
            src={previewUrl}
            sandbox="allow-scripts allow-same-origin"
            className="absolute inset-0 w-[1920px] h-[1080px] border-none pointer-events-none"
            style={{
              transformOrigin: "0 0",
              transform: `scale(${80 / 1920})`,
            }}
            tabIndex={-1}
          />
        )}
        {/* Static thumbnail — hidden while hovering */}
        <div
          className="absolute inset-0 transition-opacity duration-150"
          style={{ opacity: hovered ? 0 : 1 }}
        >
          <img
            src={thumbnailUrl}
            alt={name}
            loading="lazy"
            className="w-full h-full object-contain"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <span className="text-[11px] font-medium text-neutral-300 truncate block">{name}</span>
        <span className="text-[9px] text-neutral-600 truncate block">{comp}</span>
      </div>
    </div>
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
