import { AuthError, ErrOAuthNotConfigured } from "./errors.js";

const PROD_CLIENT_ID = "Zg3LF4FCLoeJoGs2YqMtZ17g";

export function oauthEnvironment(): "prod" | "dev" {
  const value = process.env["HYPERFRAMES_ENV"] || "prod";
  if (value === "prod" || value === "dev") return value;
  throw new AuthError("OAUTH_NOT_CONFIGURED", "HYPERFRAMES_ENV must be prod or dev");
}

export function defaultClientId(): string {
  return oauthEnvironment() === "prod" ? PROD_CLIENT_ID : "9QoaiwCZov9O0cAkC4OZbR4p";
}

export function resolveClientId(): string {
  const id = process.env["HYPERFRAMES_OAUTH_CLIENT_ID"] || defaultClientId();
  if (!id) throw ErrOAuthNotConfigured();
  return id;
}

export function tokenEndpoint(): string {
  return (
    process.env["HYPERFRAMES_OAUTH_TOKEN_URL"] ||
    `https://api2.${oauthEnvironment() === "dev" ? "dev." : ""}heygen.com/v1/oauth/token`
  );
}

export function authorizeEndpoint(): string {
  return (
    process.env["HYPERFRAMES_OAUTH_AUTHORIZE_URL"] ||
    (oauthEnvironment() === "dev"
      ? "https://api2.dev.heygen.com/v1/oauth/authorize"
      : "https://app.heygen.com/oauth/authorize")
  );
}

export function revokeEndpoint(): string {
  return (
    process.env["HYPERFRAMES_OAUTH_REVOKE_URL"] ||
    `https://api2.${oauthEnvironment() === "dev" ? "dev." : ""}heygen.com/v1/oauth/revoke`
  );
}

export function deviceAuthorizationEndpoint(): string {
  return (
    process.env["HYPERFRAMES_OAUTH_DEVICE_URL"] ||
    `https://api2.${oauthEnvironment() === "dev" ? "dev." : ""}heygen.com/v1/oauth/device_authorization`
  );
}

export function oauthIdentity(): { client_id: string; token_endpoint: string } {
  return { client_id: resolveClientId(), token_endpoint: tokenEndpoint() };
}

export function assertOAuthIdentity(tokens: { client_id?: string; token_endpoint?: string }): void {
  const identity = oauthIdentity();
  if (
    tokens.client_id !== identity.client_id ||
    tokens.token_endpoint !== identity.token_endpoint
  ) {
    throw new AuthError(
      "LOGIN_EXPIRED",
      "This login belongs to a different OAuth client or environment",
      "Run `hyperframes auth login` to sign into the selected HyperFrames environment.",
    );
  }
}
