/**
 * IconButton — Button's square sibling for icon-only controls.
 *
 * Shares Button's base and variant classes verbatim, so the two can never drift
 * apart on focus ring, disabled look or motion. The only difference is the box:
 * a square on the same three control heights, which keeps every icon control on
 * the same grid as every labelled one.
 *
 * `aria-label` is required by the type. An icon-only control with no accessible
 * name is unreachable by name for screen-reader and voice-control users.
 */

import { forwardRef } from "react";
import type { ReactNode } from "react";
import { buttonBase, buttonVariants, type ButtonBaseProps, type ButtonSize } from "./Button";
import { cn } from "./cn";

interface IconButtonProps extends ButtonBaseProps {
  icon: ReactNode;
  "aria-label": string;
}

/** Square boxes on the same 24 / 28 / 32 px control heights as Button. */
const iconSizeStyles: Record<ButtonSize, string> = {
  sm: "size-ctl-sm rounded-sm",
  md: "size-ctl rounded-md",
  lg: "size-ctl-lg rounded-md",
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon, size = "md", variant = "ghost", className, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled}
        aria-disabled={disabled || undefined}
        className={cn(buttonBase, buttonVariants[variant], iconSizeStyles[size], className)}
        {...props}
      >
        {icon}
      </button>
    );
  },
);
IconButton.displayName = "IconButton";
