import {
  AuthClient,
  startAuthorizationCodeFlow,
  tryResolveOAuthCredential,
} from "../auth/index.js";
import type { ResolvedCredential, UserInfo } from "../auth/index.js";

export type ThreadMessageStackAuthorizationOutcome =
  | "authorized"
  | "api-key-only"
  | "cancelled"
  | "failed";

interface AuthorizationDeps {
  authenticate?: () => Promise<true | "cancelled" | "failed">;
  verify?: (credential: ResolvedCredential) => Promise<UserInfo>;
}

async function defaultAuthenticate(): Promise<true | "failed"> {
  try {
    await startAuthorizationCodeFlow();
    return true;
  } catch {
    return "failed";
  }
}

/**
 * Require a persisted HeyGen OAuth session and verify it against the current-user
 * endpoint. Environment/file API keys never satisfy this primitive boundary.
 */
export async function authorizeThreadMessageStackInstall(
  deps: AuthorizationDeps = {},
): Promise<ThreadMessageStackAuthorizationOutcome> {
  const authenticate = deps.authenticate ?? defaultAuthenticate;
  const verify =
    deps.verify ?? (async (credential) => await new AuthClient().getCurrentUser(credential));
  let credential = await tryResolveOAuthCredential();

  if (!credential) {
    const outcome = await authenticate();
    if (outcome !== true) return outcome;
    credential = await tryResolveOAuthCredential();
    if (!credential) return "api-key-only";
  }

  try {
    await verify(credential);
    return "authorized";
  } catch {
    return "failed";
  }
}
