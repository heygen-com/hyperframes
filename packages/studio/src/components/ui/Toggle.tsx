/**
 * Toggle — Base UI's switch wearing Studio's tokens.
 *
 * A switch, not a checkbox: it takes effect immediately, there is no form to
 * submit, and `role="switch"` is what assistive tech should hear. That role is
 * also why `typingTarget.ts` grew an entry in this PR (KTD13): the native
 * checkboxes this replaces matched its `input` selector, and a `<button
 * role="switch">` would silently have started leaking Space to the global
 * playback shortcut instead of flipping.
 */

import { Switch } from "@base-ui/react/switch";
import { cn } from "./cn";
import type { PreviewState } from "./Button";

export interface ToggleProps {
  /** Accessible name. */
  label: string;
  checked: boolean;
  /** Called on every flip. */
  onCommit: (next: boolean) => void;
  /** Called once per flip, for design-input telemetry. */
  onTrack?: () => void;
  disabled?: boolean;
  className?: string;
  "data-preview-state"?: PreviewState;
}

export function Toggle({
  label,
  checked,
  onCommit,
  onTrack,
  disabled,
  className,
  "data-preview-state": previewState,
}: ToggleProps) {
  return (
    <Switch.Root
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onCheckedChange={(next) => {
        onCommit(next);
        onTrack?.();
      }}
      data-preview-state={previewState}
      className={cn(
        "relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full p-0.5",
        "border border-border-input bg-input",
        "transition-[background-color,border-color] ease-standard duration-press",
        "hover:border-border-strong data-[preview-state=hover]:border-border-strong",
        "data-[checked]:border-accent data-[checked]:bg-accent",
        "outline-hidden focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
        "data-[preview-state=focus]:outline-solid data-[preview-state=focus]:outline-2 data-[preview-state=focus]:outline-offset-1 data-[preview-state=focus]:outline-accent",
        "disabled:cursor-not-allowed disabled:opacity-40",
        className,
      )}
    >
      <Switch.Thumb
        className={cn(
          "size-3 rounded-full bg-text-3",
          "transition-[transform,background-color] ease-standard duration-press",
          "data-[checked]:translate-x-3 data-[checked]:bg-bg-0",
        )}
      />
    </Switch.Root>
  );
}
