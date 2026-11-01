import type { ComponentPropsWithoutRef } from "react";
import { cn } from "./cn";

/** A keyboard shortcut drawn as a keycap, in theme tokens so it reads in any theme. */
export function ShortcutKey({ className, ...props }: ComponentPropsWithoutRef<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex min-w-[1.4em] shrink-0 items-center justify-center rounded-sm border border-border-input bg-input px-1 py-px font-mono text-step-10 tabular-nums text-text-3",
        className,
      )}
      {...props}
    />
  );
}
