import { Component, Suspense, type ReactNode } from "react";

/**
 * Suspense + error boundary for a `React.lazy` panel. The fallback fills the
 * panel's slot (`h-full w-full flex-1`) so a deferred panel can't collapse the
 * layout while its chunk is in flight, and a rejected chunk load renders a
 * visible, recoverable error instead of an empty box.
 */
interface LazyPanelProps {
  children: ReactNode;
  label: string;
}

interface LazyPanelErrorBoundaryState {
  failed: boolean;
}

class LazyPanelErrorBoundary extends Component<LazyPanelProps, LazyPanelErrorBoundaryState> {
  state: LazyPanelErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): LazyPanelErrorBoundaryState {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <div
        role="alert"
        className="flex h-full min-h-0 w-full flex-1 flex-col items-center justify-center gap-3 text-center text-xs text-red-300"
      >
        <span>Couldn’t load {this.props.label}.</span>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded border border-neutral-700 px-3 py-1.5 text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-white"
        >
          Retry
        </button>
      </div>
    );
  }
}

export function LazyPanel({ children, label }: LazyPanelProps) {
  return (
    <LazyPanelErrorBoundary label={label}>
      <Suspense
        fallback={
          <div
            role="status"
            className="flex h-full min-h-0 w-full flex-1 items-center justify-center text-xs text-neutral-500"
          >
            Loading {label}…
          </div>
        }
      >
        {children}
      </Suspense>
    </LazyPanelErrorBoundary>
  );
}
