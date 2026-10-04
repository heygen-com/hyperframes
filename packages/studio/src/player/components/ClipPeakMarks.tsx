import { useEffect, useState, type ReactNode } from "react";
import { clipPeakRuns, type ClipSourceWindow, type PeakMap } from "./clipPeakRuns";
import { loadPeakMap } from "./clipPeakMap";

const dbText = (db: number) => `${db < 0 ? "−" : "+"}${Math.abs(db).toFixed(1)} dBFS`;

/** A clip's waveform with red marks where it, at its own volume, reaches the export ceiling. */
export function ClipPeakMarks({
  peaksUrl,
  sourceWindow,
  gain,
  children,
}: {
  peaksUrl: string | undefined;
  sourceWindow: ClipSourceWindow;
  gain: number;
  children?: ReactNode;
}) {
  const [map, setMap] = useState<PeakMap | null>(null);
  useEffect(() => {
    if (!peaksUrl) return;
    let live = true;
    void loadPeakMap(peaksUrl).then((loaded) => {
      if (live) setMap(loaded);
    });
    return () => {
      live = false;
    };
  }, [peaksUrl]);
  const { runs, peakDbfs } = map
    ? clipPeakRuns(map, sourceWindow, gain)
    : { runs: [], peakDbfs: null };
  return (
    <div className="relative h-full w-full">
      {children}
      {runs.length > 0 && peakDbfs !== null && (
        <div
          className="pointer-events-none absolute inset-0"
          data-testid="clip-peak-marks"
          title={`Peaks ${dbText(peakDbfs)} at this volume; export lowers the whole mix`}
        >
          {runs.map((run) => (
            <div
              key={run.from}
              className="absolute inset-y-0 bg-red-500/80"
              style={{
                left: `${run.from * 100}%`,
                width: `max(1px, ${(run.to - run.from) * 100}%)`,
              }}
            />
          ))}
          <span
            className="absolute top-0 right-1 font-mono text-[9px] leading-none text-red-400"
            data-peak-badge
          >
            ▲<span data-peak-text> peaks {dbText(peakDbfs)}</span>
          </span>
        </div>
      )}
    </div>
  );
}
