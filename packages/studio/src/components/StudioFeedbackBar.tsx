import { memo, useState, useCallback, useRef, useEffect } from "react";
import { trackStudioFeedback } from "../telemetry/events";

const DEFAULT_FEEDBACK_INTERVAL = 10;
const AUTO_DISMISS_MS = 20_000;

function isFeedbackDisabled(): boolean {
  try {
    return import.meta.env.VITE_HYPERFRAMES_NO_FEEDBACK === "1";
  } catch {
    return false;
  }
}

// fallow-ignore-next-line complexity
function getFeedbackInterval(): number {
  try {
    const v = import.meta.env.VITE_HYPERFRAMES_FEEDBACK_INTERVAL as string | undefined;
    if (v) {
      const n = parseInt(v, 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
  } catch {
    // import.meta.env unavailable
  }
  return DEFAULT_FEEDBACK_INTERVAL;
}

const STORAGE_KEYS = {
  sessionCount: "hyperframes-studio:feedbackSessionCount",
  lastPromptedAt: "hyperframes-studio:feedbackLastPromptedAt",
} as const;

// fallow-ignore-next-line complexity
function shouldShowFeedback(): boolean {
  if (isFeedbackDisabled()) return false;
  try {
    const count = parseInt(localStorage.getItem(STORAGE_KEYS.sessionCount) || "0", 10) || 0;
    const lastAt = parseInt(localStorage.getItem(STORAGE_KEYS.lastPromptedAt) || "0", 10) || 0;
    return count - lastAt >= getFeedbackInterval();
  } catch {
    return false;
  }
}

const SESSION_COUNTED_KEY = "hyperframes-studio:feedbackSessionCounted";

// fallow-ignore-next-line complexity
function incrementSessionCount(): void {
  try {
    if (sessionStorage.getItem(SESSION_COUNTED_KEY)) return;
    sessionStorage.setItem(SESSION_COUNTED_KEY, "1");
    const count = parseInt(localStorage.getItem(STORAGE_KEYS.sessionCount) || "0", 10) || 0;
    localStorage.setItem(STORAGE_KEYS.sessionCount, String(count + 1));
  } catch {
    // storage unavailable
  }
}

function markPrompted(): void {
  try {
    const count = localStorage.getItem(STORAGE_KEYS.sessionCount) || "0";
    localStorage.setItem(STORAGE_KEYS.lastPromptedAt, count);
  } catch {
    // localStorage unavailable
  }
}

// fallow-ignore-next-line complexity
export const StudioFeedbackBar = memo(function StudioFeedbackBar() {
  const [visible, setVisible] = useState(false);
  const [entered, setEntered] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [exiting, setExiting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // On mount: increment session count, check if we should show
  useEffect(() => {
    incrementSessionCount();
    // Small delay so the bar doesn't flash on page load
    const showTimer = setTimeout(() => {
      if (shouldShowFeedback()) {
        setVisible(true);
      }
    }, 3000);
    return () => clearTimeout(showTimer);
  }, []);

  // Animate height in on entrance — appearing 3s after load, an instant 32px
  // bar shoves the whole preview stack up mid-task.
  useEffect(() => {
    if (!visible) return;
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, [visible]);

  // Auto-dismiss timer — reset when user interacts (sets rating)
  useEffect(() => {
    if (!visible || rating !== null || submitted) return;
    dismissTimerRef.current = setTimeout(() => {
      handleDismiss();
    }, AUTO_DISMISS_MS);
    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, rating, submitted]);

  // Focus text input when rating is selected
  useEffect(() => {
    if (rating !== null && inputRef.current) {
      inputRef.current.focus();
    }
  }, [rating]);

  const handleDismiss = useCallback(() => {
    setExiting(true);
    markPrompted();
    setTimeout(() => setVisible(false), 300);
  }, []);

  const handleSubmit = useCallback(() => {
    if (rating === null) return;
    trackStudioFeedback({
      rating,
      comment: comment.trim() || undefined,
    });
    setSubmitted(true);
    markPrompted();
    setTimeout(() => {
      setExiting(true);
      setTimeout(() => setVisible(false), 300);
    }, 1500);
  }, [rating, comment]);

  const handleRating = useCallback((n: number) => {
    setRating(n);
    // Cancel auto-dismiss — user is engaged
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }, []);

  if (!visible) return null;

  return (
    <div
      className={[
        "flex items-center gap-3 px-4 overflow-hidden border-t border-neutral-800/50 bg-neutral-900/80 text-[11px] transition-all duration-300 motion-reduce:transition-none",
        entered && !exiting ? "h-8 opacity-100" : "h-0 opacity-0 border-t-transparent",
      ].join(" ")}
    >
      {submitted ? (
        <span className="text-neutral-500">Thanks for the feedback!</span>
      ) : rating !== null ? (
        <>
          <input
            ref={inputRef}
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
              if (e.key === "Escape") handleDismiss();
            }}
            placeholder="Any details? (enter to send, esc to close)"
            className="flex-1 bg-transparent border-none text-[11px] text-neutral-300 placeholder-neutral-600 outline-none"
            maxLength={500}
          />
          <button
            onClick={handleSubmit}
            className="text-[11px] text-neutral-500 hover:text-neutral-300 transition-colors flex-shrink-0"
          >
            send
          </button>
        </>
      ) : (
        <>
          <span className="text-neutral-500 flex-shrink-0">Recommend HyperFrames?</span>
          <div className="flex items-center gap-0.5">
            {Array.from({ length: 11 }, (_, n) => n).map((n) => (
              <button
                key={n}
                onClick={() => handleRating(n)}
                className="w-6 h-6 rounded text-[11px] text-neutral-600 hover:text-neutral-200 hover:bg-neutral-700/50 transition-colors"
              >
                {n}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <button
            onClick={handleDismiss}
            className="text-neutral-700 hover:text-neutral-400 transition-colors flex-shrink-0"
            aria-label="Dismiss"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </>
      )}
    </div>
  );
});
