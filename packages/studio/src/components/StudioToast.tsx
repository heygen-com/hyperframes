interface StudioToastProps {
  message: string;
  tone?: "error" | "info";
}

export function StudioToast({ message, tone }: StudioToastProps) {
  return (
    <div
      className={`absolute bottom-6 left-1/2 -translate-x-1/2 z-[91] px-4 py-2 rounded-lg border text-sm shadow-lg animate-in fade-in slide-in-from-bottom-2 ${
        tone === "error"
          ? "bg-red-900/90 border-red-700/50 text-red-200"
          : "bg-neutral-900/95 border-neutral-700/60 text-neutral-100"
      }`}
    >
      {message}
    </div>
  );
}
