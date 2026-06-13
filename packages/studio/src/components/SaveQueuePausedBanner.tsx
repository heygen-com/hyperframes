interface SaveQueuePausedBannerProps {
  message: string;
  onDismiss: () => void;
}

/** Alert shown when the DOM-edit save queue circuit breaker pauses persistence. */
export function SaveQueuePausedBanner({ message, onDismiss }: SaveQueuePausedBannerProps) {
  return (
    <div
      className="absolute left-1/2 top-14 z-[92] flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-3 rounded-md border border-red-500/30 bg-red-950/85 px-4 py-2 text-[12px] font-medium text-red-100 shadow-lg shadow-black/30"
      role="alert"
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="rounded border border-red-300/20 px-2 py-1 text-[11px] text-red-100 transition-colors hover:bg-red-400/10"
      >
        Dismiss
      </button>
    </div>
  );
}
