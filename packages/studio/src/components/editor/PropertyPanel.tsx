import { memo } from "react";
import { X, MousePointer, Move, Type, Palette, Clock, Eye } from "../../icons/SystemIcons";
import { Button, IconButton } from "../ui";
import type { PickedElement } from "../../hooks/useElementPicker";

interface PropertyPanelProps {
  element: PickedElement | null;
  isPickMode: boolean;
  onEnablePick: () => void;
  onDisablePick: () => void;
  onClearPick: () => void;
  onSetStyle: (prop: string, value: string) => void;
  onSetDataAttr: (attr: string, value: string) => void;
  onSetText?: (text: string) => void;
}

function PropertyRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-2xs text-neutral-600 w-16 flex-shrink-0 text-right">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 bg-neutral-900 border border-neutral-800 rounded px-1.5 py-0.5 text-2xs text-neutral-200 font-mono outline-none focus:border-neutral-600 min-w-0"
      />
    </div>
  );
}

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-2xs text-neutral-600 w-16 flex-shrink-0 text-right">{label}</span>
      <div className="flex items-center gap-1 flex-1">
        <div
          className="w-5 h-5 rounded border border-neutral-700 flex-shrink-0"
          style={{ backgroundColor: value }}
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 bg-neutral-900 border border-neutral-800 rounded px-1.5 py-0.5 text-2xs text-neutral-200 font-mono outline-none focus:border-neutral-600 min-w-0"
        />
      </div>
    </div>
  );
}

function SectionHeader({ icon: Icon, label }: { icon: typeof Move; label: string }) {
  return (
    <div className="flex items-center gap-1.5 mt-2 mb-1">
      <Icon size={10} className="text-neutral-600" />
      <span className="text-2xs font-medium text-neutral-500 uppercase tracking-wider">
        {label}
      </span>
    </div>
  );
}

export const PropertyPanel = memo(function PropertyPanel({
  element,
  isPickMode,
  onEnablePick,
  onDisablePick,
  onClearPick,
  onSetStyle,
  onSetDataAttr,
  onSetText,
}: PropertyPanelProps) {
  if (!element) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-4 text-center">
        <MousePointer size={20} className="text-neutral-700 mb-2" />
        <p className="text-xs text-neutral-500">Click an element in the preview to inspect it</p>
        <Button
          variant="secondary"
          size="sm"
          onClick={isPickMode ? onDisablePick : onEnablePick}
          className={`mt-3 ${isPickMode ? "bg-studio-accent/20 text-studio-accent border-studio-accent/30" : ""}`}
        >
          {isPickMode ? "Pick mode active..." : "Enable Pick Mode"}
        </Button>
      </div>
    );
  }

  const s = element.computedStyles;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800 flex-shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-2xs font-mono text-studio-accent truncate">{element.selector}</span>
        </div>
        <div className="flex items-center gap-1">
          <IconButton
            icon={<MousePointer size={11} />}
            aria-label={isPickMode ? "Disable pick mode" : "Enable pick mode"}
            size="sm"
            onClick={isPickMode ? onDisablePick : onEnablePick}
            className={isPickMode ? "text-studio-accent bg-studio-accent/10" : ""}
          />
          <IconButton
            icon={<X size={11} />}
            aria-label="Clear selection"
            size="sm"
            onClick={onClearPick}
          />
        </div>
      </div>

      {/* Properties */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
        {/* Element info */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-2xs text-neutral-300 font-medium">{element.label}</span>
          <span className="text-2xs text-neutral-600 font-mono">&lt;{element.tagName}&gt;</span>
        </div>

        {/* Position & Size */}
        <SectionHeader icon={Move} label="Position & Size" />
        <div className="grid grid-cols-2 gap-1">
          <PropertyRow
            label="X"
            value={s["left"] ?? "auto"}
            onChange={(v) => onSetStyle("left", v)}
          />
          <PropertyRow
            label="Y"
            value={s["top"] ?? "auto"}
            onChange={(v) => onSetStyle("top", v)}
          />
          <PropertyRow
            label="W"
            value={s["width"] ?? "auto"}
            onChange={(v) => onSetStyle("width", v)}
          />
          <PropertyRow
            label="H"
            value={s["height"] ?? "auto"}
            onChange={(v) => onSetStyle("height", v)}
          />
        </div>

        {/* Typography */}
        {(element.tagName === "div" ||
          element.tagName === "span" ||
          element.tagName === "p" ||
          element.tagName === "h1" ||
          element.tagName === "h2") && (
          <>
            <SectionHeader icon={Type} label="Typography" />
            <PropertyRow
              label="Size"
              value={s["font-size"] ?? ""}
              onChange={(v) => onSetStyle("font-size", v)}
            />
            <PropertyRow
              label="Weight"
              value={s["font-weight"] ?? ""}
              onChange={(v) => onSetStyle("font-weight", v)}
            />
            <PropertyRow
              label="Family"
              value={s["font-family"]?.split(",")[0] ?? ""}
              onChange={(v) => onSetStyle("font-family", v)}
            />
          </>
        )}

        {/* Colors */}
        <SectionHeader icon={Palette} label="Colors" />
        <ColorRow
          label="Color"
          value={s["color"] ?? "#fff"}
          onChange={(v) => onSetStyle("color", v)}
        />
        <ColorRow
          label="Background"
          value={s["background-color"] ?? "transparent"}
          onChange={(v) => onSetStyle("background-color", v)}
        />

        {/* Appearance */}
        <SectionHeader icon={Eye} label="Appearance" />
        <PropertyRow
          label="Opacity"
          value={s["opacity"] ?? "1"}
          onChange={(v) => onSetStyle("opacity", v)}
        />
        <PropertyRow
          label="Radius"
          value={s["border-radius"] ?? "0"}
          onChange={(v) => onSetStyle("border-radius", v)}
        />
        <PropertyRow
          label="Z-index"
          value={s["z-index"] ?? "auto"}
          onChange={(v) => onSetStyle("z-index", v)}
        />
        <PropertyRow
          label="Transform"
          value={s["transform"] ?? "none"}
          onChange={(v) => onSetStyle("transform", v)}
        />

        {/* Timing */}
        {(element.dataAttributes["start"] || element.dataAttributes["duration"]) && (
          <>
            <SectionHeader icon={Clock} label="Timing" />
            {element.dataAttributes["start"] != null && (
              <PropertyRow
                label="Start"
                value={element.dataAttributes["start"]}
                onChange={(v) => onSetDataAttr("start", v)}
              />
            )}
            {element.dataAttributes["duration"] != null && (
              <PropertyRow
                label="Duration"
                value={element.dataAttributes["duration"]}
                onChange={(v) => onSetDataAttr("duration", v)}
              />
            )}
            {element.dataAttributes["track-index"] != null && (
              <PropertyRow
                label="Track"
                value={element.dataAttributes["track-index"]}
                onChange={(v) => onSetDataAttr("track-index", v)}
              />
            )}
          </>
        )}

        {/* Editable text content */}
        {element.textContent && (
          <>
            <SectionHeader icon={Type} label="Text Content" />
            <textarea
              defaultValue={element.textContent}
              onBlur={(e) => onSetText?.(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.metaKey) {
                  (e.target as HTMLTextAreaElement).blur();
                }
              }}
              rows={3}
              className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1.5 text-xs text-neutral-200 outline-none focus:border-neutral-600 resize-y leading-relaxed"
              placeholder="Edit text..."
            />
          </>
        )}
      </div>
    </div>
  );
});
