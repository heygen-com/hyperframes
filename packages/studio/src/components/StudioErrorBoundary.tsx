import { Component, type ErrorInfo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { trackStudioEvent } from "../utils/studioTelemetry";

function StudioErrorFallback({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const { t } = useTranslation();

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-neutral-950 font-sans text-neutral-200">
      <div className="text-lg font-semibold">{t("shell.errorBoundary.somethingWentWrong")}</div>
      <div className="max-w-[480px] text-center text-[13px] text-neutral-500">{error.message}</div>
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={onRetry}
          className="rounded-md bg-studio-accent px-5 py-2 text-sm font-medium text-neutral-950 transition-[filter] hover:brightness-110 active:scale-[0.98]"
        >
          {t("shell.errorBoundary.tryAgain")}
        </button>
        {/* If the error recurs immediately, "Try again" loops — a full reload
            is the recovery path that always works. */}
        <button
          onClick={() => window.location.reload()}
          className="rounded-md border border-neutral-700 px-5 py-2 text-sm font-medium text-neutral-300 transition-colors hover:bg-neutral-800 active:scale-[0.98]"
        >
          {t("shell.errorBoundary.reloadStudio")}
        </button>
      </div>
    </div>
  );
}

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class StudioErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[Studio] Uncaught error:", error, info.componentStack);
    trackStudioEvent("crash", {
      error_message: error.message,
      error_name: error.name,
      stack_trace: error.stack?.slice(0, 4000) ?? null,
      component_stack: info.componentStack?.slice(0, 2000) ?? null,
    });
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <StudioErrorFallback
        error={this.state.error}
        onRetry={() => this.setState({ error: null })}
      />
    );
  }
}
