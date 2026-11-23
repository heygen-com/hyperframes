import { expect, it } from "vitest";
import { shareEventInput } from "./shareEvents.js";
const interactions = [
  { event: "share_upgrade_clicked", reason: "project_limit" },
  { event: "share_upgrade_clicked", reason: "sharing_permissions" },
  { event: "share_audience_selected", audience: "invite" },
  { event: "share_source_toggled", enabled: false },
  { event: "share_navigation_clicked", destination: "manage" },
  { event: "share_action_clicked", action: "access" },
];
it.each(interactions)("accepts a bounded sharing interaction: $event", (event) => {
  expect(shareEventInput(event)).toEqual(event);
  expect(shareEventInput({ ...event, url: "https://secret.test/token" })).toBeNull();
});
it.each([
  { event: "share_upgrade_clicked", reason: "private project" },
  { event: "share_audience_selected", audience: "email@example.com" },
  { event: "share_source_toggled", enabled: "true" },
  { event: "share_navigation_clicked", destination: "https://secret.test" },
  { event: "share_action_clicked", action: "delete" },
])("rejects unrecognized values: $event", (event) => {
  expect(shareEventInput(event)).toBeNull();
});
