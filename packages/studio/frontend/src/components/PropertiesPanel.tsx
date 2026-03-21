import { X } from "lucide-react";
import type { TimelineElement } from "../store/playerStore";

const TAG_COLORS: Record<string, { bg: string; text: string }> = {
  video: { bg: "bg-blue-100", text: "text-blue-700" },
  audio: { bg: "bg-emerald-100", text: "text-emerald-700" },
  img: { bg: "bg-violet-100", text: "text-violet-700" },
  div: { bg: "bg-amber-100", text: "text-amber-700" },
};
const DEFAULT_COLOR = { bg: "bg-neutral-100", text: "text-neutral-600" };

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(1);
  return `${m}:${s.padStart(4, "0")}`;
}

interface PropertiesPanelProps {
  element: TimelineElement;
  projectId: string;
  onClose: () => void;
}

export function PropertiesPanel({ element, projectId, onClose }: PropertiesPanelProps) {
  const color = TAG_COLORS[element.tag] ?? DEFAULT_COLOR;
  const hasMedia = element.src && (element.tag === "video" || element.tag === "audio" || element.tag === "img");
  const mediaSrc = element.src ? `/api/projects/${projectId}/serve/${element.src}` : null;

  return (
    <div className="w-72 flex-shrink-0 border-l border-neutral-200/80 bg-white flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-100">
        <h3 className="text-sm font-semibold text-neutral-800 truncate">
          {element.id || element.tag}
        </h3>
        <button
          onClick={onClose}
          className="text-neutral-400 hover:text-neutral-600 transition-colors p-1 rounded hover:bg-neutral-100"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Media preview */}
        {hasMedia && mediaSrc && (
          <div className="px-4 py-3 border-b border-neutral-100">
            {element.tag === "video" && (
              <video
                src={mediaSrc}
                controls
                className="w-full rounded bg-black"
                preload="metadata"
              />
            )}
            {element.tag === "audio" && (
              <audio
                src={mediaSrc}
                controls
                className="w-full"
                preload="metadata"
              />
            )}
            {element.tag === "img" && (
              <img
                src={mediaSrc}
                alt={element.id}
                className="w-full rounded object-contain bg-neutral-50 max-h-40"
              />
            )}
          </div>
        )}

        {/* Properties list */}
        <div className="px-4 py-3 space-y-2.5">
          <Row label="Type">
            <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-medium ${color.bg} ${color.text}`}>
              {element.tag}
            </span>
          </Row>
          <Row label="ID">
            <span className="text-sm text-neutral-800 font-mono">{element.id}</span>
          </Row>
          <Row label="Start">
            <span className="text-sm text-neutral-800 font-mono">{formatTime(element.start)}</span>
          </Row>
          <Row label="Duration">
            <span className="text-sm text-neutral-800 font-mono">{formatTime(element.duration)}</span>
          </Row>
          <Row label="End">
            <span className="text-sm text-neutral-800 font-mono">{formatTime(element.start + element.duration)}</span>
          </Row>
          <Row label="Track">
            <span className="text-sm text-neutral-800">{element.track}</span>
          </Row>
          {element.volume != null && (
            <Row label="Volume">
              <span className="text-sm text-neutral-800">{Math.round(element.volume * 100)}%</span>
            </Row>
          )}
          {element.mediaStart != null && (
            <Row label="Playback offset">
              <span className="text-sm text-neutral-800 font-mono">{formatTime(element.mediaStart)}</span>
            </Row>
          )}
          {element.src && (
            <Row label="Source">
              <span className="text-sm text-neutral-800 font-mono truncate block max-w-[160px]" title={element.src}>
                {element.src}
              </span>
            </Row>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-xs text-neutral-500 flex-shrink-0 pt-0.5">{label}</span>
      {children}
    </div>
  );
}
