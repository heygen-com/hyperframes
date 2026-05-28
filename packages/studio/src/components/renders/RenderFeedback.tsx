import { memo, useState, useCallback, useRef, useEffect } from "react";
import { trackStudioRenderFeedback } from "../../telemetry/events";

interface RenderFeedbackProps {
  onDismiss: () => void;
}

export const RenderFeedback = memo(function RenderFeedback({ onDismiss }: RenderFeedbackProps) {
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (rating !== null && inputRef.current) {
      inputRef.current.focus();
    }
  }, [rating]);

  const handleSubmit = useCallback(() => {
    if (rating === null) return;
    trackStudioRenderFeedback({
      rating,
      comment: comment.trim() || undefined,
    });
    setSubmitted(true);
    setTimeout(onDismiss, 1500);
  }, [rating, comment, onDismiss]);

  if (submitted) {
    return <div className="px-3 py-1.5 text-[10px] text-neutral-500">Thanks for the feedback!</div>;
  }

  if (rating !== null) {
    return (
      <div className="px-3 py-1.5 flex items-center gap-1.5">
        <input
          ref={inputRef}
          type="text"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
          }}
          placeholder="Any details? (optional)"
          className="flex-1 bg-neutral-800/50 border border-neutral-700/50 rounded px-2 py-0.5 text-[10px] text-neutral-300 placeholder-neutral-600 outline-none focus:border-neutral-600"
          maxLength={500}
        />
        <button
          onClick={handleSubmit}
          className="text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors"
        >
          send
        </button>
      </div>
    );
  }

  return (
    <div className="px-3 py-1.5 flex items-center gap-2">
      <span className="text-[10px] text-neutral-500">How was this render?</span>
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            onClick={() => setRating(n)}
            className="w-5 h-5 rounded text-[10px] text-neutral-500 hover:text-neutral-200 hover:bg-neutral-700/50 transition-colors"
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
});
