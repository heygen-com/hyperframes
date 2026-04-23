import { TIMELINE_TOGGLE_SHORTCUT_LABEL } from "../../utils/timelineDiscovery";

interface TimelineEditorNoticeProps {
  onDismiss: () => void;
}

export function TimelineEditorNotice({ onDismiss }: TimelineEditorNoticeProps) {
  return (
    <aside
      aria-live="polite"
      className="pointer-events-none relative w-[320px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-white/10 bg-[#0f1115]/88 text-neutral-100 shadow-[0_18px_40px_rgba(0,0,0,0.3),0_4px_14px_rgba(0,0,0,0.18)] backdrop-blur-xl"
    >
      <style>{`
        @keyframes hfTimelineNoticeClipNudge {
          0%, 100% { transform: translate3d(0, 0, 0); }
          20% { transform: translate3d(0, 0, 0); }
          52% { transform: translate3d(12px, 0, 0); }
          72% { transform: translate3d(12px, 0, 0); }
          100% { transform: translate3d(0, 0, 0); }
        }

        @keyframes hfTimelineNoticePlayheadSweep {
          0% { transform: translateX(0); opacity: 0; }
          10% { opacity: 1; }
          75% { opacity: 1; }
          100% { transform: translateX(218px); opacity: 0; }
        }

        @media (prefers-reduced-motion: reduce) {
          .hf-timeline-notice-clip,
          .hf-timeline-notice-playhead {
            animation: none !important;
          }
        }
      `}</style>

      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss timeline editor notice"
        className="pointer-events-auto absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-lg text-neutral-500 transition-colors duration-150 hover:bg-white/[0.06] hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-accent/50"
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.25"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      <div className="flex items-start gap-3 px-4 py-3.5">
        <div className="min-w-0 flex-1">
          <div
            aria-hidden="true"
            className="mb-3 overflow-hidden rounded-[14px] bg-[#0d1117] p-2.5"
          >
            <div className="relative overflow-hidden rounded-[11px] bg-[#0f141c] px-2.5 pb-2 pt-1.5">
              <div className="mb-1.5 flex items-center justify-between pl-6 pr-1 text-[8px] font-medium text-[#7f8796]">
                <span>0:00</span>
                <span>0:05</span>
                <span>0:10</span>
              </div>

              <div className="pointer-events-none absolute inset-x-0 top-[18px] h-px bg-white/[0.04]" />
              <div
                className="hf-timeline-notice-playhead pointer-events-none absolute left-[31px] top-[18px] h-[70px] w-0"
                style={{
                  animation:
                    "hfTimelineNoticePlayheadSweep 2.8s cubic-bezier(0.4, 0, 0.2, 1) infinite",
                }}
              >
                <div
                  className="absolute top-0 bottom-0"
                  style={{
                    left: "50%",
                    width: 2,
                    marginLeft: -1,
                    background: "var(--hf-accent, #3CE6AC)",
                    boxShadow: "0 0 8px rgba(60,230,172,0.5)",
                  }}
                />
                <div
                  className="absolute"
                  style={{ left: "50%", top: 0, transform: "translateX(-50%)" }}
                >
                  <div
                    style={{
                      width: 0,
                      height: 0,
                      borderLeft: "6px solid transparent",
                      borderRight: "6px solid transparent",
                      borderTop: "8px solid var(--hf-accent, #3CE6AC)",
                      filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.6))",
                    }}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                {[0, 1, 2].map((trackIndex) => (
                  <div
                    key={trackIndex}
                    className="relative h-6 overflow-hidden rounded-[10px] bg-white/[0.035]"
                  >
                    <div className="absolute inset-y-0 left-[24px] w-px bg-white/[0.035]" />
                    <div className="absolute inset-y-0 left-[100px] w-px bg-white/[0.035]" />
                    <div className="absolute inset-y-0 left-[176px] w-px bg-white/[0.035]" />
                  </div>
                ))}
              </div>

              <div className="pointer-events-none absolute inset-x-0 top-[21px] h-[70px]">
                <div className="absolute left-[34px] top-[3px] h-[18px] w-[56px] rounded-[9px] bg-white/[0.07]" />
                <div
                  className="hf-timeline-notice-clip absolute left-[82px] top-[27px] h-[18px] w-[110px] rounded-[9px] bg-studio-accent/18 ring-1 ring-inset ring-studio-accent/28"
                  style={{
                    animation:
                      "hfTimelineNoticeClipNudge 2.8s cubic-bezier(0.4, 0, 0.2, 1) infinite",
                  }}
                />
                <div className="absolute left-[52px] top-[51px] h-[18px] w-[72px] rounded-[9px] bg-white/[0.07]" />
              </div>
            </div>
          </div>

          <div className="min-w-0 pr-9">
            <p className="text-[12px] font-semibold leading-none tracking-tight text-neutral-100">
              Timeline editing is on
            </p>
            <p className="mt-1.5 text-[12px] leading-5 text-neutral-300">
              Drag clips to move timing, use{" "}
              <span className="font-mono text-[11px] text-studio-accent">Shift</span> + click to
              edit a full clip range, and watch for resize handles only on clips Studio can patch
              safely. Toggle the timeline with{" "}
              <span className="rounded-md border border-white/8 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[11px] text-studio-accent">
                {TIMELINE_TOGGLE_SHORTCUT_LABEL}
              </span>
              .
            </p>
          </div>

          <div className="mt-2 text-[10px] leading-none text-neutral-500">
            Dismiss once and it stays hidden.
          </div>
        </div>
      </div>
    </aside>
  );
}
