/**
 * NumberField — Base UI's number field in Studio's boxed field.
 *
 * This is the inspector's metric control: a number, an optional unit, keyboard
 * stepping with the arrow keys, and a commit that happens at a boundary rather
 * than per keystroke. Base UI owns the hard parts (character filtering, locale
 * parsing, alt and shift step sizes); this file owns when a value is written.
 *
 * Three commit boundaries, and only three (KTD11):
 *
 *  - blur, through Base UI's own `onValueCommitted`,
 *  - Enter, read straight off the input text,
 *  - a settled step, through `onValueCommitted` again (arrow keys, the wheel,
 *    releasing the increment button).
 *
 * `onValueChange` fires per keystroke and is deliberately not a commit site.
 *
 * The unit is a sibling of the input, not part of its text, so nothing has to
 * parse "48 px" back apart and the suffix survives every commit.
 *
 * Invalid text is text the field could not parse. Base UI blocks most of it at
 * the keystroke, but paste and programmatic writes get through, and on blur it
 * silently keeps the old value. Silence is the wrong answer for an inspector
 * field, so the unparseable case shows a red boundary and commits nothing.
 */

import { NumberField as BaseNumberField } from "@base-ui/react/number-field";
import { useEffect, useRef, useState } from "react";
import { cn } from "./cn";
import { fieldBase, fieldText } from "./Input";
import type { PreviewState } from "./Button";

export interface NumberFieldProps {
  /** Accessible name. The inspector's row label is the usual one. */
  label: string;
  /** The committed value. */
  value: number;
  /** Called when a commit boundary produces a value different from `value`. */
  onCommit: (next: number) => void;
  /** Called once per committed change, for design-input telemetry. */
  onTrack?: () => void;
  /** Rendered beside the number: "px", "%", "deg". Never part of the text. */
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  /**
   * Forces the invalid look. The field decides this for itself while the user
   * types; the prop is for a consumer that already knows the value is rejected,
   * and it is what lets a story or a screenshot show the state without typing.
   * Named and shaped like `Input`'s so the two boxes take the same flag.
   */
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
  "data-preview-state"?: PreviewState;
}

export function NumberField({
  label,
  value,
  onCommit,
  onTrack,
  unit,
  min,
  max,
  step,
  invalid: forcedInvalid,
  disabled,
  className,
  "data-preview-state": previewState,
}: NumberFieldProps) {
  const [draft, setDraft] = useState<number | null>(value);
  const [selfInvalid, setSelfInvalid] = useState(false);
  const invalid = forcedInvalid || selfInvalid;
  const inputRef = useRef<HTMLInputElement>(null);
  // What was last handed to `onCommit`, which is not the same as `value`: a
  // blur can fire both Base UI's commit and ours in one turn, before the parent
  // has re-rendered with the new prop, and the second must be a no-op.
  const committedRef = useRef(value);
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    committedRef.current = value;
    setDraft(value);
    setSelfInvalid(false);
  }, [value]);

  const commit = (next: number | null) => {
    if (next === null || !Number.isFinite(next)) {
      setSelfInvalid(true);
      return;
    }
    setSelfInvalid(false);
    if (next === committedRef.current) return;
    committedRef.current = next;
    onCommit(next);
    onTrack?.();
  };

  /** Enter commits what is on screen, which Base UI has not parsed for us yet. */
  const commitFromText = () => {
    const text = inputRef.current?.value.trim() ?? "";
    commit(text === "" ? null : Number(text));
  };

  return (
    <BaseNumberField.Root
      value={draft}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onValueChange={(next) => {
        setDraft(next);
        if (next !== null) setSelfInvalid(false);
      }}
      onValueCommitted={(next) => commit(next)}
    >
      <BaseNumberField.Group
        className={cn(fieldBase, className)}
        aria-invalid={invalid || undefined}
        data-preview-state={previewState}
      >
        <BaseNumberField.Input
          ref={inputRef}
          aria-label={label}
          aria-invalid={invalid || undefined}
          className={cn(fieldText, "tabular-nums")}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            commitFromText();
          }}
          onBlur={() => {
            // Base UI's own blur handler returns without committing when the
            // text does not parse. That is the only case left for us: a valid
            // blur has already arrived through `onValueCommitted`.
            const text = inputRef.current?.value.trim() ?? "";
            if (text === "" || !Number.isFinite(Number(text))) setSelfInvalid(true);
          }}
        />
        {unit && (
          <span className="shrink-0 select-none text-step-10 text-text-4" aria-hidden="true">
            {unit}
          </span>
        )}
      </BaseNumberField.Group>
    </BaseNumberField.Root>
  );
}
