import type { LocalShareInteraction } from "@hyperframes/studio-server";

function choice<T extends string | boolean>(value: unknown, ...allowed: T[]): T | undefined {
  return allowed.find((item) => item === value);
}
export function shareEventInput(value: unknown): LocalShareInteraction | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  if (Object.keys(value).length !== 2 || !("event" in value)) return null;
  const field = (key: string): unknown => Reflect.get(value, key);
  switch (value.event) {
    case "share_opened": {
      const link = choice(field("link"), "none", "live", "changed");
      return link === undefined ? null : { event: value.event, link };
    }
    case "share_link_copied": {
      const via = choice(field("via"), "copy");
      return via === undefined ? null : { event: value.event, via };
    }
    case "share_upgrade_clicked": {
      const reason = choice(field("reason"), "project_limit", "sharing_permissions");
      return reason === undefined ? null : { event: value.event, reason };
    }
    default:
      return settingInteraction(value);
  }
}

function settingInteraction(value: object & { event: unknown }): LocalShareInteraction | null {
  const field = (key: string): unknown => Reflect.get(value, key);
  switch (value.event) {
    case "share_audience_selected": {
      const audience = choice(field("audience"), "public", "team", "invite", "private");
      return audience === undefined ? null : { event: value.event, audience };
    }
    case "share_source_toggled": {
      const enabled = choice(field("enabled"), true, false);
      return enabled === undefined ? null : { event: value.event, enabled };
    }
    case "share_navigation_clicked": {
      const destination = choice(field("destination"), "manage", "shared_page");
      return destination === undefined ? null : { event: value.event, destination };
    }
    case "share_action_clicked": {
      const action = choice(field("action"), "share", "update", "access", "off", "on", "login");
      return action === undefined ? null : { event: value.event, action };
    }
    default:
      return null;
  }
}
