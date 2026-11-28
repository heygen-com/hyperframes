import { useEffect, useId, useRef, useState } from "react";
import { Select } from "../ui/Select";
import { fieldBase, fieldText } from "../ui/Input";
import { cn } from "../ui/cn";
import { validateRateControl, type RateControl, type RenderSettings } from "./renderSettings";

interface AdvancedRenderSettingsProps {
  settings: RenderSettings;
  disabled: boolean;
  onChange: (patch: Partial<RenderSettings>) => void;
  onValidityChange: (invalid: boolean) => void;
}

function rateValue(rate: RateControl): string {
  return rate.mode === "auto" ? "" : String(rate.value);
}

function rateHelp(
  mode: RateControl["mode"],
  format: RenderSettings["format"],
  maxCrf: number,
): string {
  if (format === "mov") return "ProRes uses fixed quality; CRF and target bitrate are unavailable.";
  if (mode === "crf")
    return `Use an integer between 0 and ${maxCrf}. Lower CRF usually preserves more detail and increases file size. Blank uses the quality preset.`;
  if (mode === "bitrate")
    return "Custom bitrate overrides the preset's rate control. The target is not a guarantee of the measured average bitrate. Blank uses the quality preset.";
  return "Custom CRF or bitrate overrides the quality preset's rate control.";
}

interface RateControlInputProps {
  id: string;
  mode: "crf" | "bitrate";
  maxCrf: number;
  value: string;
  error: string | null;
  disabled: boolean;
  onEdit: (value: string, badInput: boolean) => void;
}

function RateControlInput({
  id,
  mode,
  maxCrf,
  value,
  error,
  disabled,
  onEdit,
}: RateControlInputProps) {
  const isCrf = mode === "crf";
  const label = isCrf ? "CRF" : "Target bitrate";
  const inputProps = isCrf
    ? { type: "number", min: 0, max: maxCrf, step: 1, placeholder: `0 to ${maxCrf}` }
    : { type: "text", placeholder: "e.g. 10M or 2500k" };
  return (
    <>
      <label htmlFor={`${id}-rate`} className="text-step-10 text-text-4">
        {label}
      </label>
      <div className={fieldBase} aria-invalid={error ? true : undefined}>
        <input
          {...inputProps}
          id={`${id}-rate`}
          aria-label={label}
          value={value}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-errormessage={error ? `${id}-rate-error` : undefined}
          aria-describedby={`${id}-rate-help`}
          onChange={(event) => onEdit(event.target.value, event.target.validity.badInput)}
          className={cn(fieldText, "disabled:opacity-40")}
        />
      </div>
    </>
  );
}

export function AdvancedRenderSettings({
  settings,
  disabled,
  onChange,
  onValidityChange,
}: AdvancedRenderSettingsProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState(settings.rateControl.mode);
  const [draft, setDraft] = useState(() => rateValue(settings.rateControl));
  const [error, setError] = useState<string | null>(null);
  const previousFormat = useRef(settings.format);
  const id = useId();
  const maxCrf = settings.format === "webm" ? 63 : 51;
  const isMov = settings.format === "mov";

  // A format change commits normalized settings and discards incompatible drafts.
  useEffect(() => {
    if (previousFormat.current === settings.format) return;
    previousFormat.current = settings.format;
    setMode(settings.rateControl.mode);
    setDraft(rateValue(settings.rateControl));
    setError(null);
    onValidityChange(false);
  }, [settings.format, settings.rateControl, onValidityChange]);

  const selectMode = (next: string) => {
    if (next !== "auto" && next !== "crf" && next !== "bitrate") return;
    setMode(next);
    setDraft("");
    setError(null);
    onValidityChange(false);
    onChange({ rateControl: { mode: "auto" } });
  };

  const editRate = (value: string, badInput: boolean) => {
    setDraft(value);
    if (badInput) {
      setError(`CRF must be an integer between 0 and ${maxCrf}.`);
      onValidityChange(true);
      return;
    }
    const trimmed = value.trim();
    const rate: RateControl =
      trimmed === "" || mode === "auto"
        ? { mode: "auto" }
        : mode === "crf"
          ? { mode: "crf", value: Number(trimmed) }
          : { mode: "bitrate", value: trimmed };
    const nextError = validateRateControl(rate, settings.format);
    setError(nextError);
    onValidityChange(nextError !== null);
    if (nextError === null) onChange({ rateControl: rate });
  };

  return (
    <div className="border-t border-border pt-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-advanced`}
        onClick={() => setOpen(!open)}
        className="text-step-10 text-text-3 hover:text-text-1 outline-hidden focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-accent"
      >
        Advanced
      </button>
      {error && (
        <p id={`${id}-rate-error`} role="alert" className="pt-2 text-step-9 text-danger-ink">
          {error}
        </p>
      )}
      {open && (
        <div id={`${id}-advanced`} className="flex flex-col gap-3 pt-2">
          <div className="flex flex-col gap-1" role="group" aria-describedby={`${id}-rate-help`}>
            <span className="text-step-10 text-text-4">Rate control</span>
            <Select
              label="Rate control"
              value={mode}
              disabled={disabled || isMov}
              options={[
                { value: "auto", label: "Quality preset" },
                { value: "crf", label: "CRF" },
                { value: "bitrate", label: "Target bitrate" },
              ]}
              onCommit={selectMode}
            />
            {mode !== "auto" && (
              <RateControlInput
                id={id}
                mode={mode}
                maxCrf={maxCrf}
                value={draft}
                error={error}
                disabled={disabled || isMov}
                onEdit={editRate}
              />
            )}
            <p id={`${id}-rate-help`} className="text-step-9 text-text-5">
              {rateHelp(mode, settings.format, maxCrf)}
            </p>
          </div>
          <div className="flex flex-col gap-1" role="group" aria-describedby={`${id}-frames-help`}>
            <span className="text-step-10 text-text-4">Source video frames</span>
            <Select
              label="Source video frames"
              value={settings.videoFrameFormat}
              disabled={disabled}
              options={[
                { value: "auto", label: "Auto" },
                { value: "jpg", label: "JPG" },
                { value: "png", label: "PNG" },
              ]}
              onCommit={(value) => {
                if (value === "auto" || value === "jpg" || value === "png")
                  onChange({ videoFrameFormat: value });
              }}
            />
            <p id={`${id}-frames-help`} className="text-step-9 text-text-5">
              Controls embedded source video frame extraction, not page screenshots or the output
              format. Alpha-capable sources may still use PNG to preserve transparency.
            </p>
          </div>
          <div className="flex flex-col gap-1" role="group" aria-describedby={`${id}-hdr-help`}>
            <span className="text-step-10 text-text-4">HDR</span>
            <Select
              label="HDR"
              value={settings.hdrMode}
              disabled={disabled}
              options={[
                { value: "auto", label: "Auto" },
                { value: "force-hdr", label: "Force on" },
                { value: "force-sdr", label: "Force off" },
              ]}
              onCommit={(value) => {
                if (value === "auto" || value === "force-hdr" || value === "force-sdr")
                  onChange({ hdrMode: value });
              }}
            />
            <p id={`${id}-hdr-help`} className="text-step-9 text-text-5">
              HDR output currently requires MP4 and native HDR video or images. Force on requests
              HDR processing; it does not guarantee HDR output for every composition.
              {settings.format !== "mp4" && " WebM and MOV currently export as SDR."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
