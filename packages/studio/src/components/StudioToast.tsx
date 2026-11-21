import { X } from "../icons/SystemIcons";
import { toastPersists } from "../hooks/useToast";

interface StudioToastProps {
  message: string;
  tone: "error" | "info";
  onDismiss: () => void;
}

export function StudioToast({ message, tone, onDismiss }: StudioToastProps) {
  const persists = toastPersists(tone);
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      onClick={persists ? undefined : onDismiss}
      onKeyDown={(event) => {
        if (event.key === "Escape") onDismiss();
      }}
      className={`hf-notice-in flex min-h-12 w-fit max-w-[min(680px,100%)] items-center gap-1.5 rounded-3xl bg-text-0 py-1.5 pr-1.5 pl-5 text-[14px] leading-5 font-medium wrap-anywhere text-bg-0 shadow-notice not-has-[button]:pr-5 ${persists ? "" : "cursor-pointer"}`}
    >
      <span className="min-w-0 flex-1 text-pretty">{message}</span>
      {persists && (
        <button
          type="button"
          onClick={onDismiss}
          className="relative ml-2 grid h-9 w-9 shrink-0 place-items-center rounded-full text-bg-0/72 transition-[background-color,color,scale] duration-hover ease-out hover:bg-bg-0/16 hover:text-bg-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bg-0 active:scale-[0.96]"
          aria-label="Dismiss"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
