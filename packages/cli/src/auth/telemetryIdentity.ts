import { createHash } from "node:crypto";
import type { UserInfo } from "./client.js";

export interface TelemetryIdentity {
  distinctId: string;
  /** PostHog person properties. `heygen_username` joins one person across HeyGen's projects. */
  traits: Record<string, string>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The id the HyperFrames web app and Desktop key their users on: a UUID as is, else its sha256-derived UUID. */
export function heygenUserId(username: string): string {
  if (UUID_PATTERN.test(username)) return username;
  const hash = createHash("sha256").update(username).digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = hash.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/** Keyed on the username's user id; an account without one falls back to its lowercased email. */
export function telemetryIdentity(user: UserInfo): TelemetryIdentity | undefined {
  const email = user.email?.trim().toLowerCase() || undefined;
  const username = user.username?.trim() ? user.username : undefined;
  const traits: Record<string, string> = {};
  if (email) traits.email = email;
  if (username) traits.heygen_username = username;
  if (username) return { distinctId: heygenUserId(username), traits };
  if (email) return { distinctId: email, traits };
  return undefined;
}
