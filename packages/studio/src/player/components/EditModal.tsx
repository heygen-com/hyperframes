import { useState, useCallback, useMemo, useRef } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";
import { usePlayerStore } from "../store/playerStore";
import { formatTime } from "../lib/time";

interface EditPopoverProps {
  rangeStart: number;
  rangeEnd: number;
  anchorX: number;
  anchorY: number;
  onClose: () => void;
}

export function EditPopover({ rangeStart, rangeEnd, anchorX, anchorY, onClose }: EditPopoverProps) {
  const elements = usePlayerStore((s) => s.elements);
  const [prompt, setPrompt] = useState("");
  const [copied, setCopied] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const start = Math.min(rangeStart, rangeEnd);
  const end = Math.max(rangeStart, rangeEnd);

  const elementsInRange = useMemo(() => {
    return elements.filter((el) => {
      const elEnd = el.start + el.duration;
      return el.start < end && elEnd > start;
    });
  }, [elements, start, end]);

  useMountEffect(() => {
    setTimeout(() => textareaRef.current?.focus(), 50);
  });

  useMountEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  useMountEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    setTimeout(() => window.addEventListener("mousedown", handleClick), 100);
    return () => window.removeEventListener("mousedown", handleClick);
  });

  const buildClipboardText = useCallback(() => {
    const elementLines = elementsInRange
      .map(
        (el) =>
          `- #${el.id} (${el.tag}) — ${formatTime(el.start)} to ${formatTime(el.start + el.duration)}, track ${el.track}`,
      )
      .join("\n");

    return `Edit the following HyperFrames composition:

Time range: ${formatTime(start)} — ${formatTime(end)}

Elements in range:
${elementLines || "(none)"}

User request:
${prompt.trim() || "(no prompt provided)"}

Instructions:
Modify only the elements listed above within the specified time range.
The composition uses HyperFrames data attributes (data-start, data-duration, data-track-index) and GSAP for animations.
Preserve all other elements and timing outside this range.`;
  }, [start, end, elementsInRange, prompt]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(buildClipboardText());
    } catch {
      const ta = document.createElement("textarea");
      ta.value = buildClipboardText();
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
      onClose();
    }, 800);
  }, [buildClipboardText, onClose]);

  const style: React.CSSProperties = {
    position: "fixed",
    left: Math.max(8, Math.min(anchorX - 160, window.innerWidth - 336)),
    top: Math.max(8, anchorY - 280),
    zIndex: 200,
  };

  return (
    <div ref={popoverRef} style={style}>
      <div className="w-80 bg-neutral-900 border border-neutral-700/60 rounded-xl shadow-2xl shadow-black/40 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-800/60">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-studio-accent" />
            <span className="text-[11px] font-medium text-neutral-300">
              {formatTime(start)} — {formatTime(end)}
            </span>
          </div>
          <span className="text-[10px] text-neutral-600">
            {elementsInRange.length} element{elementsInRange.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Elements */}
        {elementsInRange.length > 0 && (
          <div className="px-4 py-2 border-b border-neutral-800/40 max-h-24 overflow-y-auto">
            {elementsInRange.map((el) => (
              <div key={el.id} className="flex items-center justify-between py-0.5">
                <span className="text-[10px] font-mono text-studio-accent/80">#{el.id}</span>
                <span className="text-[10px] text-neutral-600">{el.tag}</span>
              </div>
            ))}
          </div>
        )}

        {/* Prompt */}
        <div className="p-3">
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleCopy();
              }
            }}
            placeholder="What should change?"
            rows={2}
            className="w-full px-3 py-2 text-xs bg-neutral-800/60 border border-neutral-700/40 rounded-lg text-neutral-200 placeholder:text-neutral-600 resize-none focus:outline-none focus:border-studio-accent/40 transition-colors"
          />
        </div>

        {/* Action */}
        <div className="px-3 pb-3">
          <button
            onClick={handleCopy}
            className={`w-full py-1.5 text-[11px] font-medium rounded-lg transition-all ${
              copied
                ? "bg-green-500/20 text-green-400 border border-green-500/30"
                : "bg-studio-accent/15 text-studio-accent border border-studio-accent/25 hover:bg-studio-accent/25"
            }`}
          >
            {copied ? "Copied!" : "Copy to Agent"}
            {!copied && <span className="text-[9px] text-studio-accent/50 ml-1.5">Cmd+Enter</span>}
          </button>
        </div>
      </div>
    </div>
  );
}
