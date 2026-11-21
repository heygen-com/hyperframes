import type { LocalShareInteraction } from "@hyperframes/studio-server";
import { browserTelemetryAllowed } from "../../telemetry/policy";
import { studioApiFetch } from "../../utils/studioApiFetch";

export function shareInteraction(token: string, event: LocalShareInteraction): void {
  if (!browserTelemetryAllowed()) return;
  void studioApiFetch("/api/share/events", {
    method: "POST",
    signal: AbortSignal.timeout(5000),
    headers: { "Content-Type": "application/json", "X-Hyperframes-Share-CSRF": token },
    body: JSON.stringify(event),
  }).catch(() => {});
}
