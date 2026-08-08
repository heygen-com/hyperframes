// Opt-in diagnostic channels — one per question worth tracing, all off by
// default. Turn one on for the session with `localStorage.setItem("hf-<name>-debug",
// "1")` and reload, then grep the console for `[hf-<name>]`.
//
// These exist because the interesting failures here are decisions, not crashes:
// a preview that reloads when it should not, a shift-click that selects nothing.
// Nothing is thrown and nothing is logged by default, so without a trace of the
// decision the only way to find the cause is to guess.
type DebugLogger = (stage: string, data?: Record<string, unknown>) => void;

export function makeStudioDebugLogger(name: string): DebugLogger {
  let enabled: boolean | null = null;
  return (stage, data = {}) => {
    if (enabled === null) {
      try {
        enabled = localStorage.getItem(`hf-${name}-debug`) === "1";
      } catch {
        enabled = false;
      }
    }
    if (!enabled) return;
    console.log(
      `[hf-${name}] ${JSON.stringify({ stage, t: Math.round(performance.now()), ...data })}`,
    );
  };
}
