import { Component, type ErrorInfo, type ReactNode } from "react";
import { trackStudioEvent } from "../utils/studioTelemetry";

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
      <div
        style={{
          position: "fixed",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0a",
          color: "#e5e5e5",
          fontFamily: "system-ui, -apple-system, sans-serif",
          gap: 16,
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 600 }}>Something went wrong</div>
        <div style={{ fontSize: 13, color: "#888", maxWidth: 480, textAlign: "center" }}>
          {this.state.error.message}
        </div>
        <button
          onClick={() => this.setState({ error: null })}
          style={{
            marginTop: 8,
            padding: "8px 20px",
            background: "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </div>
    );
  }
}
