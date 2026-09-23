import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { IconContext } from "@phosphor-icons/react";
import { StudioApp } from "./App";
import { StudioErrorBoundary } from "./components/StudioErrorBoundary";
import { readIconTokens } from "./styles/iconTokens";
import { trackStudioEvent } from "./utils/studioTelemetry";
import { prefetchPreviewForHash } from "./utils/previewPrefetch";
import "./styles/studio.css";

prefetchPreviewForHash(window.location.hash);
window.addEventListener("hashchange", () => prefetchPreviewForHash(window.location.hash));
trackStudioEvent("session_start");

function errorProps(value: unknown): {
  error_message: string;
  error_name: string | null;
  stack_trace: string | null;
} {
  if (value instanceof Error) {
    return {
      error_message: value.message,
      error_name: value.name,
      stack_trace: value.stack?.slice(0, 4000) ?? null,
    };
  }
  return { error_message: String(value), error_name: null, stack_trace: null };
}

// fallow-ignore-next-line complexity
function isCompositionAssetError(msg: string, name: string | null): boolean {
  if (msg.includes("Error fetching") && (msg.includes("404") || msg.includes("Not Found")))
    return true;
  if (name === "EncodingError" || msg.includes("unsupported or unrecognizable format")) return true;
  if (msg.includes("MEDIA_ERR_SRC_NOT_SUPPORTED")) return true;
  return false;
}

const ERROR_CAP = 50;
let errorCount = 0;
let rejectionCount = 0;
let errorCapSent = false;
let rejectionCapSent = false;

window.addEventListener("error", (event) => {
  if (event.message?.includes("ResizeObserver loop")) {
    event.stopImmediatePropagation();
    event.preventDefault();
    return;
  }

  errorCount++;
  if (errorCount > ERROR_CAP) {
    if (!errorCapSent) {
      errorCapSent = true;
      trackStudioEvent("error_cap_reached", { count: errorCount });
    }
    return;
  }

  trackStudioEvent("unhandled_error", {
    ...errorProps(event.error),
    error_message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
  });
});

let filteredAssetErrorCount = 0;
let filteredAbortCount = 0;
// Bounded so a hostile extension cannot grow it; a novel abort message still surfaces once.
const seenAbortMessages = new Set<string>();
const MAX_SEEN_ABORT_MESSAGES = 20;

// fallow-ignore-next-line complexity
window.addEventListener("unhandledrejection", (event) => {
  const props = errorProps(event.reason);
  if (isCompositionAssetError(props.error_message, props.error_name)) {
    filteredAssetErrorCount++;
    if (filteredAssetErrorCount === 1 || filteredAssetErrorCount % 100 === 0) {
      trackStudioEvent("composition_asset_error_filtered", {
        error_message: props.error_message.slice(0, 200),
        error_name: props.error_name,
        total_filtered: filteredAssetErrorCount,
      });
    }
    return;
  }
  // An AbortError rejection is a cancellation we asked for, not a failure. Our own
  // fetch chains handle it; the unhandled copies come from browser extensions that
  // wrap window.fetch and derive a promise from each request without a rejection
  // handler, so they reject with our abort reason whenever a thumbnail lease is
  // released mid-fetch. Filtered before the cap so a scroll burst cannot exhaust
  // ERROR_CAP and silence the session's real rejections. Sampled per distinct
  // message, so an abort we have not seen before (e.g. our own "Aborted") is
  // recorded once instead of drowning in the extension flood.
  if (props.error_name === "AbortError") {
    filteredAbortCount++;
    const message = props.error_message.slice(0, 200);
    const novel =
      !seenAbortMessages.has(message) && seenAbortMessages.size < MAX_SEEN_ABORT_MESSAGES;
    if (novel) seenAbortMessages.add(message);
    if (novel || filteredAbortCount % 100 === 0) {
      trackStudioEvent("abort_rejection_filtered", {
        error_message: message,
        total_filtered: filteredAbortCount,
      });
    }
    return;
  }

  rejectionCount++;
  if (rejectionCount > ERROR_CAP) {
    if (!rejectionCapSent) {
      rejectionCapSent = true;
      trackStudioEvent("rejection_cap_reached", { count: rejectionCount });
    }
    return;
  }

  trackStudioEvent("unhandled_promise_rejection", props);
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* One icon size and weight for the whole app, taken from the theme file.
        Icons that pass their own size or weight still win. */}
    <IconContext.Provider value={readIconTokens()}>
      <StudioErrorBoundary>
        <StudioApp />
      </StudioErrorBoundary>
    </IconContext.Provider>
  </StrictMode>,
);
