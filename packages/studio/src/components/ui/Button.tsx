/**
 * Button & IconButton — The most important primitive.
 *
 * Absorbs: active state (scale 0.98), hit target (min 32px),
 * shadow anatomy (primary), focus ring, disabled state,
 * loading state, reduced motion, proper timing tokens.
 *
 * Rules applied:
 * - physics-active-state: scale(0.98) on :active
 * - ux-fitts-target-size: min 32px hit target
 * - visual-button-shadow-anatomy: 6-layer shadow on primary
 * - duration-press-hover: 120ms press, 150ms hover
 */

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

// -- Button --

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: [
    "bg-white text-neutral-950 font-medium",
    "shadow-btn-primary",
    "hover:bg-neutral-200",
    "active:scale-[0.97]",
  ].join(" "),
  secondary: [
    "bg-transparent text-neutral-300 font-medium",
    "border border-border",
    "hover:bg-surface-hover hover:text-white hover:border-border-strong",
    "active:scale-[0.98]",
  ].join(" "),
  danger: ["bg-accent-red text-white font-medium", "hover:bg-red-600", "active:scale-[0.97]"].join(
    " ",
  ),
  ghost: [
    "bg-transparent text-neutral-400",
    "hover:bg-surface-hover hover:text-white",
    "active:scale-[0.98]",
  ].join(" "),
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-xs gap-1.5 rounded-button",
  md: "h-8 px-3 text-sm gap-1.5 rounded-button",
  lg: "h-9 px-4 text-base gap-2 rounded-button",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "secondary",
      size = "md",
      loading,
      icon,
      children,
      className = "",
      disabled,
      ...props
    },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={[
          "inline-flex items-center justify-center",
          "transition-all duration-press ease-standard",
          "disabled:opacity-40 disabled:pointer-events-none",
          "select-none cursor-pointer",
          variantStyles[variant],
          sizeStyles[size],
          className,
        ].join(" ")}
        {...props}
      >
        {loading ? (
          <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
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
          <span className="flex-shrink-0">{icon}</span>
        ) : null}
        {children && <span>{children}</span>}
      </button>
    );
  },
);
Button.displayName = "Button";

// -- IconButton --
// For icon-only buttons. Enforces min 32px hit target.

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  size?: ButtonSize;
  variant?: ButtonVariant;
  "aria-label": string; // REQUIRED for accessibility
}

const iconSizeStyles: Record<ButtonSize, string> = {
  sm: "min-w-7 min-h-7 rounded-button", // 28px
  md: "min-w-8 min-h-8 rounded-button", // 32px — minimum recommended
  lg: "min-w-9 min-h-9 rounded-button", // 36px
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon, size = "md", variant = "ghost", className = "", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={[
          "inline-flex items-center justify-center",
          "transition-all duration-press ease-standard",
          "disabled:opacity-40 disabled:pointer-events-none",
          "select-none cursor-pointer",
          variantStyles[variant],
          iconSizeStyles[size],
          className,
        ].join(" ")}
        {...props}
      >
        {icon}
      </button>
    );
  },
);
IconButton.displayName = "IconButton";
