export function GpuEncodingToggle({
  format,
  checked,
  disabled,
  onToggle,
}: {
  format: "mp4" | "webm" | "mov";
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  // GPU encoders exist for H.264/H.265 only, so only MP4 can use one.
  if (format !== "mp4") return null;
  return (
    <label
      className={`flex items-center gap-2 text-step-10 text-text-4 ${disabled ? "opacity-50" : "cursor-pointer"}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
        className="accent-studio-accent"
      />
      <span>Use GPU encoding</span>
    </label>
  );
}
