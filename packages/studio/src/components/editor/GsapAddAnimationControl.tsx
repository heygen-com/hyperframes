import { ADD_METHODS, ADD_METHOD_LABELS, METHOD_TOOLTIPS } from "./gsapAnimationConstants";

const STYLES = {
  classic: {
    method:
      "rounded-lg border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-[11px] font-medium text-neutral-300 transition-colors hover:border-neutral-600 hover:text-white",
    cancel: "px-1.5 text-[11px] text-neutral-500 hover:text-neutral-300",
    trigger: "text-[11px] font-medium text-neutral-400 transition-colors hover:text-neutral-200",
  },
  flat: {
    method:
      "rounded-lg border border-panel-border-input bg-panel-input px-2.5 py-1.5 text-[11px] font-medium text-panel-text-2 transition-colors hover:border-panel-text-4 hover:text-panel-text-0",
    cancel: "px-1.5 text-[11px] text-panel-text-3 hover:text-panel-text-1",
    trigger: "text-[11px] font-medium text-panel-text-3 transition-colors hover:text-panel-text-1",
  },
};

export function GsapAddAnimationControl({
  open,
  setOpen,
  onAddAnimation,
  track,
  variant,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  onAddAnimation: (method: "to" | "from" | "set" | "fromTo") => void;
  track: (control: string, name: string) => void;
  variant: keyof typeof STYLES;
}) {
  const styles = STYLES[variant];

  return (
    <div className="relative pt-1">
      {open ? (
        <div className="flex gap-1.5">
          {ADD_METHODS.map((method) => (
            <button
              key={method}
              type="button"
              title={METHOD_TOOLTIPS[method]}
              onClick={() => {
                track("button", `Add ${method} animation`);
                onAddAnimation(method);
                setOpen(false);
              }}
              className={styles.method}
            >
              {ADD_METHOD_LABELS[method] ?? method}
            </button>
          ))}
          <button type="button" onClick={() => setOpen(false)} className={styles.cancel}>
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={styles.trigger}
          title="Add a new animation effect to this element"
        >
          + Add effect
        </button>
      )}
    </div>
  );
}
