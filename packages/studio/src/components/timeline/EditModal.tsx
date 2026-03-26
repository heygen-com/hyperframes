import { useState, useCallback, useMemo } from "react";
import { usePlayerStore } from "../../player/store/playerStore";
import { formatTime } from "../../player/lib/time";

interface EditModalProps {
  onClose: () => void;
}

export function EditModal({ onClose }: EditModalProps) {
  const elements = usePlayerStore((s) => s.elements);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const selectedId = usePlayerStore((s) => s.selectedElementId);

  const [rangeStart, setRangeStart] = useState(() => {
    // Default: if an element is selected, use its start. Otherwise use playhead.
    const sel = elements.find((e) => e.id === selectedId);
    return sel ? sel.start : Math.max(0, currentTime - 1);
  });
  const [rangeEnd, setRangeEnd] = useState(() => {
    const sel = elements.find((e) => e.id === selectedId);
    return sel ? sel.start + sel.duration : Math.min(duration, currentTime + 5);
  });
  const [prompt, setPrompt] = useState("");
  const [copied, setCopied] = useState(false);

  const elementsInRange = useMemo(() => {
    const start = Math.min(rangeStart, rangeEnd);
    const end = Math.max(rangeStart, rangeEnd);
    return elements.filter((el) => {
      const elEnd = el.start + el.duration;
      return el.start < end && elEnd > start;
    });
  }, [elements, rangeStart, rangeEnd]);

  const buildClipboardText = useCallback(() => {
    const start = Math.min(rangeStart, rangeEnd);
    const end = Math.max(rangeStart, rangeEnd);

    const elementLines = elementsInRange
      .map(
        (el) =>
          `- #${el.id} (${el.tag}) — ${formatTime(el.start)} to ${formatTime(el.start + el.duration)}, track ${el.track}`,
      )
      .join("\n");

    return `Edit the following HyperFrames composition:

Time range: ${formatTime(start)} — ${formatTime(end)}

Elements in range:
${elementLines}

User request:
${prompt.trim() || "(no prompt provided)"}

Instructions:
Modify only the elements listed above within the specified time range.
The composition uses HyperFrames data attributes (data-start, data-duration, data-track-index) and GSAP for animations.
Preserve all other elements and timing outside this range.`;
  }, [rangeStart, rangeEnd, elementsInRange, prompt]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(buildClipboardText());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const textarea = document.createElement("textarea");
      textarea.value = buildClipboardText();
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [buildClipboardText]);

  const start = Math.min(rangeStart, rangeEnd);
  const end = Math.max(rangeStart, rangeEnd);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-neutral-950 border border-neutral-800 rounded-xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800">
          <div>
            <h2 className="text-sm font-semibold text-neutral-200">Edit Range</h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              {formatTime(start)} — {formatTime(end)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-500 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M18 6L6 18" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Range sliders */}
        <div className="px-5 py-3 border-b border-neutral-800/50">
          <div className="flex gap-4">
            <label className="flex-1">
              <span className="text-[10px] uppercase tracking-wider text-neutral-500">Start</span>
              <input
                type="range"
                min={0}
                max={duration}
                step={0.1}
                value={rangeStart}
                onChange={(e) => setRangeStart(Number(e.target.value))}
                className="w-full mt-1 accent-blue-500"
              />
              <span className="text-xs text-neutral-400 font-mono">{formatTime(rangeStart)}</span>
            </label>
            <label className="flex-1">
              <span className="text-[10px] uppercase tracking-wider text-neutral-500">End</span>
              <input
                type="range"
                min={0}
                max={duration}
                step={0.1}
                value={rangeEnd}
                onChange={(e) => setRangeEnd(Number(e.target.value))}
                className="w-full mt-1 accent-blue-500"
              />
              <span className="text-xs text-neutral-400 font-mono">{formatTime(rangeEnd)}</span>
            </label>
          </div>
        </div>

        {/* Elements in range */}
        <div className="px-5 py-3 border-b border-neutral-800/50 max-h-32 overflow-y-auto">
          <p className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2">
            {elementsInRange.length} element{elementsInRange.length !== 1 ? "s" : ""} in range
          </p>
          {elementsInRange.length === 0 ? (
            <p className="text-xs text-neutral-600 italic">No elements in this range</p>
          ) : (
            <div className="space-y-1">
              {elementsInRange.map((el) => (
                <div key={el.id} className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-blue-400">#{el.id}</span>
                  <span className="text-neutral-600">({el.tag})</span>
                  <span className="text-neutral-500 ml-auto">
                    {formatTime(el.start)}–{formatTime(el.start + el.duration)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Prompt */}
        <div className="px-5 py-3">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe what you want to change..."
            className="w-full h-20 px-3 py-2 text-sm bg-neutral-900 border border-neutral-800 rounded-lg text-neutral-200 placeholder:text-neutral-600 resize-none focus:outline-none focus:border-neutral-600 transition-colors"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-neutral-800">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-200 rounded-lg hover:bg-neutral-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCopy}
            className={`px-4 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              copied ? "bg-green-600 text-white" : "bg-blue-600 hover:bg-blue-500 text-white"
            }`}
          >
            {copied ? "Copied!" : "Copy to Agent"}
          </button>
        </div>
      </div>
    </div>
  );
}
