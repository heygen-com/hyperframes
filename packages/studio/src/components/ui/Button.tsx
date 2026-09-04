/**
 * Button — a native `<button>` wearing Studio's tokens.
 *
 * Everything visual comes from `theme.css`: the three control heights, the
 * radius scale, the semantic colours, the motion durations. No value is decided
 * here, so a button cannot drift from the rest of the system.
 *
 * Two conventions run through the file:
 *
 *  - Classes are merged with `cn`, so a caller's `className` beats the
 *    variant's and the size's classes from the same group.
 *  - Every interactive look is written twice, once as the real state
 *    (`enabled:hover:…`) and once as `data-[preview-state=hover]:…`. The
 *    attribute is read by CSS only and changes no behaviour: it exists so a
 *    story or a screenshot can show the hover, active and focus looks without a
 *    pointer. `Button.test.tsx` asserts the two lists stay in step.
 */

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

/** Forces one interactive look for a gallery shot. CSS-only; see the header. */
export type PreviewState = "hover" | "active" | "focus";

export interface ButtonBaseProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  "data-preview-state"?: PreviewState;
}

interface ButtonProps extends ButtonBaseProps {
  loading?: boolean;
  icon?: ReactNode;
}

/**
 * Shared by Button and IconButton. `disabled:` keeps pointer events alive so a
 * wrapping Tooltip can still explain why the control is disabled.
 */
export const buttonBase = cn(
  "inline-flex items-center justify-center select-none cursor-pointer whitespace-nowrap",
  "transition-[background-color,border-color,color,filter,transform] ease-out-quint duration-press",
  "disabled:opacity-40 disabled:cursor-not-allowed",
  "outline-hidden",
  "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
  "data-[preview-state=focus]:outline-solid data-[preview-state=focus]:outline-2 data-[preview-state=focus]:outline-offset-1 data-[preview-state=focus]:outline-accent",
);

/**
 * One entry per variant. The `data-[preview-state=…]` half of each string
 * repeats the `hover:` and `active:` half exactly; the test pairs them.
 */
export const buttonVariants: Record<ButtonVariant, string> = {
  primary: cn(
    "bg-accent text-bg-0 font-semibold",
    "enabled:hover:brightness-110 data-[preview-state=hover]:brightness-110",
    "enabled:active:scale-[0.98] data-[preview-state=active]:scale-[0.98]",
  ),
  secondary: cn(
    "bg-transparent text-text-1 font-medium border border-border-strong",
    "enabled:hover:bg-hover enabled:hover:text-text-0 data-[preview-state=hover]:bg-hover data-[preview-state=hover]:text-text-0",
    "enabled:active:scale-[0.98] data-[preview-state=active]:scale-[0.98]",
  ),
  danger: cn(
    "bg-danger text-text-0 font-medium",
    "enabled:hover:brightness-110 data-[preview-state=hover]:brightness-110",
    "enabled:active:scale-[0.98] data-[preview-state=active]:scale-[0.98]",
  ),
  ghost: cn(
    "bg-transparent text-text-2 font-medium",
    "enabled:hover:bg-hover enabled:hover:text-text-0 data-[preview-state=hover]:bg-hover data-[preview-state=hover]:text-text-0",
    "enabled:active:scale-[0.98] data-[preview-state=active]:scale-[0.98]",
  ),
};

/**
 * The three control heights, 24 / 28 / 32 px, from `--spacing-ctl-*`.
 *
 * Exported beside `buttonBase` and `buttonVariants` for the one header control
 * a `<button>` cannot be: Capture is a download `<a href>`. A link that wears
 * the recipe from here cannot drift away from a real Button.
 */
export const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-ctl-sm px-2 gap-1 rounded-sm text-step-11",
  md: "h-ctl px-3 gap-1.5 rounded-md text-step-12",
  lg: "h-ctl-lg px-4 gap-2 rounded-md text-step-13",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { variant = "secondary", size = "md", loading, icon, children, className, disabled, ...props },
    ref,
  ) => {
    const isDisabled = disabled || loading;
    return (
      <button
        ref={ref}
        disabled={isDisabled}
        // `aria-disabled` as well as `disabled`: assistive tech announces the
        // state even where the native attribute is filtered out of the tree.
        aria-disabled={isDisabled || undefined}
        className={cn(buttonBase, buttonVariants[variant], buttonSizes[size], className)}
        {...props}
      >
        {loading ? (
          <svg className="animate-spin size-3.5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        ) : icon ? (
          <span className="shrink-0">{icon}</span>
        ) : null}
        {children && <span>{children}</span>}
      </button>
    );
  },
);
Button.displayName = "Button";
