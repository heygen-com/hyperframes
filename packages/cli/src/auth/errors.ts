/**
 * Typed errors for the auth layer. Callers branch on `code` so commands
 * can map specific failures to friendly UX without parsing messages.
 */

export type AuthErrorCode =
  | "NOT_CONFIGURED"
  | "INVALID_STORE"
  | "API_ERROR"
  | "UNAUTHENTICATED"
  | "OAUTH_NOT_CONFIGURED"
  | "DEVICE_AUTH_FAILED"
  | "REFRESH_FAILED";

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly hint?: string;

  constructor(code: AuthErrorCode, message: string, hint?: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.hint = hint;
  }
}

export const ErrNotConfigured = () =>
  new AuthError(
    "NOT_CONFIGURED",
    "No HeyGen credentials found",
    "Run `hyperframes auth login` to sign in.",
  );

export const ErrInvalidStore = (detail: string) =>
  new AuthError(
    "INVALID_STORE",
    `Credential file is unreadable: ${detail}`,
    "Delete ~/.heygen/credentials and run `hyperframes auth login` to re-create it.",
  );

export const ErrUnauthenticated = (detail?: string) =>
  new AuthError(
    "UNAUTHENTICATED",
    detail ? `HeyGen rejected the credential: ${detail}` : "HeyGen rejected the credential",
    "Run `hyperframes auth login` to re-authenticate.",
  );

export const ErrApi = (status: number, detail: string) =>
  new AuthError("API_ERROR", `HeyGen API error (${status}): ${detail}`);

export const ErrOAuthNotConfigured = () =>
  new AuthError(
    "OAUTH_NOT_CONFIGURED",
    "OAuth client is not configured",
    "Set HYPERFRAMES_OAUTH_CLIENT_ID, or run `hyperframes auth login --api-key`.",
  );

export const ErrRefreshFailed = (detail?: string) =>
  new AuthError(
    "REFRESH_FAILED",
    detail ? `Failed to refresh OAuth tokens: ${detail}` : "Failed to refresh OAuth tokens",
    "Run `hyperframes auth login` to re-authenticate.",
  );

export const ErrDeviceAuthFailed = (detail: string) =>
  new AuthError(
    "DEVICE_AUTH_FAILED",
    `Device authorization failed: ${detail}`,
    "Run `hyperframes auth login --device` to start a new code.",
  );

export function isAuthError(err: unknown): err is AuthError {
  return err instanceof AuthError;
}
