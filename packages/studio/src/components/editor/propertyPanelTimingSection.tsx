import { Clock } from "../../icons/SystemIcons";
import type { DomEditSelection } from "./domEditing";
import { RESPONSIVE_GRID } from "./propertyPanelHelpers";
import { MetricField, Section } from "./propertyPanelPrimitives";

function formatTimingValue(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0.00s";
  return `${seconds.toFixed(2)}s`;
}

function parseTimingValue(input: string): number | null {
  const cleaned = input.replace(/s$/i, "").trim();
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function TimingSection({
  element,
  onSetAttribute,
}: {
  element: DomEditSelection;
  onSetAttribute: (attr: string, value: string) => void | Promise<void>;
}) {
  const start = Number.parseFloat(element.dataAttributes.start ?? "0") || 0;
  const duration =
    Number.parseFloat(
      element.dataAttributes.duration ?? element.dataAttributes["hf-authored-duration"] ?? "0",
    ) || 0;
  const end = start + duration;

  const commitStart = (nextValue: string) => {
    const parsed = parseTimingValue(nextValue);
    if (parsed == null) return;
    void onSetAttribute("start", parsed.toFixed(2));
  };

  const commitDuration = (nextValue: string) => {
    const parsed = parseTimingValue(nextValue);
    if (parsed == null || parsed <= 0) return;
    void onSetAttribute("duration", parsed.toFixed(2));
  };

  const commitEnd = (nextValue: string) => {
    const parsed = parseTimingValue(nextValue);
    if (parsed == null || parsed <= start) return;
    void onSetAttribute("duration", (parsed - start).toFixed(2));
  };

  return (
    <Section title="Timing" icon={<Clock size={15} />}>
      <div className={RESPONSIVE_GRID}>
        <MetricField label="Start" value={formatTimingValue(start)} onCommit={commitStart} />
        <MetricField label="End" value={formatTimingValue(end)} onCommit={commitEnd} />
      </div>
      <div className="mt-3">
        <MetricField
          label="Duration"
          value={formatTimingValue(duration)}
          onCommit={commitDuration}
        />
      </div>
    </Section>
  );
}
