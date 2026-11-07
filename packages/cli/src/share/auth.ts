import { apiBaseUrl, AuthClient } from "../auth/client.js";
import { tokenEndpoint, oauthEnvironment } from "../auth/config.js";
import { AuthError } from "../auth/errors.js";
import { refreshTokens } from "../auth/oauth.js";
import { resolveCredential } from "../auth/resolver.js";

export function shareSite(): string {
  return oauthEnvironment() === "dev" ? "https://dev.hyperframes.dev" : "https://hyperframes.dev";
}

export function createShareAccess() {
  let identity: { token: string; owner: string; email: string | null } | undefined;
  const userClient = new AuthClient();
  const access = async (refused?: string) => {
    const credential = await shareCredential(refused);
    if (identity?.token !== credential.access_token) {
      const user = await userClient.getCurrentUser(credential);
      if (!user.username) throw loginRequired();
      identity = {
        token: credential.access_token,
        owner: user.username,
        email: user.email ?? null,
      };
    }
    return {
      token: credential.access_token,
      heygen: new URL(tokenEndpoint()).origin,
      heygenApi: apiBaseUrl(),
      owner: identity.owner,
    };
  };
  return {
    access,
    signedInEmail: async () => {
      await access();
      return identity?.email ?? null;
    },
  };
}

function loginRequired(): AuthError {
  return new AuthError(
    "UNAUTHENTICATED",
    "Sharing requires a signed-in HeyGen account.",
    "Run hyperframes auth login. API keys cannot own shared projects.",
  );
}

async function shareCredential(refused?: string) {
  let credential = await resolveCredential();
  if (credential.type !== "oauth") throw loginRequired();
  if (credential.refreshable || credential.access_token === refused) {
    if (!credential.refresh_token) throw loginRequired();
    await refreshTokens(credential.refresh_token);
    credential = await resolveCredential();
    if (credential.type !== "oauth") throw loginRequired();
  }
  if (credential.access_token === refused) throw loginRequired();
  return credential;
}
