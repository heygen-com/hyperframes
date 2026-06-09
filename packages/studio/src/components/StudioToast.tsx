interface StudioToastProps {
  message: string;
  tone?: "error" | "info";
  onDismiss?: () => void;
}

export function StudioToast({ message, tone, onDismiss }: StudioToastProps) {
  const isError = tone === "error";
  return (
    <div
      className="absolute bottom-6 right-6 z-[91] animate-in fade-in slide-in-from-bottom-2"
      onClick={onDismiss}
      role={onDismiss ? "button" : undefined}
      style={onDismiss ? { cursor: "pointer" } : undefined}
    >
      <div
        className="relative flex items-center gap-3 overflow-hidden rounded-2xl pl-4 pr-2 py-3 text-[12px]"
        style={{
          background: isError
            ? "linear-gradient(135deg, rgba(127,29,29,0.55), rgba(80,10,10,0.45))"
            : "linear-gradient(135deg, rgba(38,38,38,0.55), rgba(23,23,23,0.45))",
          backdropFilter: "blur(16px) saturate(1.6)",
          WebkitBackdropFilter: "blur(16px) saturate(1.6)",
          border: `1px solid ${isError ? "rgba(239,68,68,0.18)" : "rgba(255,255,255,0.08)"}`,
          boxShadow: [
            "0 8px 32px rgba(0,0,0,0.35)",
            `inset 0 1px 0 ${isError ? "rgba(239,68,68,0.12)" : "rgba(255,255,255,0.06)"}`,
            `inset 0 -1px 0 rgba(0,0,0,0.15)`,
          ].join(", "),
        }}
      >
        <span className={isError ? "text-red-200" : "text-neutral-200"}>{message}</span>
        {onDismiss && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDismiss();
            }}
            className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-white/10 hover:text-neutral-300"
            aria-label="Dismiss"
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M2 2l6 6M8 2l-6 6" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
