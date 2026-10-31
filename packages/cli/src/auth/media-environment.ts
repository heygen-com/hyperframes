import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apiBaseUrl } from "./client.js";
import { refreshTokens } from "./oauth.js";
import { AuthError, isAuthError } from "./errors.js";
import { resolveCredential, tryResolveCredential } from "./resolver.js";
import { writeStore } from "./store.js";

// Avatar helpers can poll for five minutes after submitting paid work.
const MIN_HELPER_TOKEN_LIFETIME_MS = 10 * 60 * 1000;

/** The Go CLI accepts OAuth through a credential file, but cannot refresh a HyperFrames grant. */
export async function withMediaAuthEnvironment<T>(run: (env: NodeJS.ProcessEnv) => T): Promise<T> {
  let credential;
  try {
    credential = await tryResolveCredential();
  } catch (error) {
    // An expired login must not stop anonymous/local providers or select another wallet.
    if (!isAuthError(error) || error.code !== "LOGIN_EXPIRED") throw error;
  }
  const expiresDuringHelper =
    credential?.type === "oauth" &&
    credential.expires_at !== undefined &&
    credential.expires_at.getTime() - Date.now() < MIN_HELPER_TOKEN_LIFETIME_MS;
  if (
    credential?.type === "oauth" &&
    credential.refresh_token &&
    (credential.refreshable || expiresDuringHelper)
  ) {
    await refreshTokens(credential.refresh_token);
    credential = await resolveCredential();
  }

  const dir = await fs.mkdtemp(join(tmpdir(), "hyperframes-media-auth-"));
  try {
    await fs.chmod(dir, 0o700);
    const env: NodeJS.ProcessEnv = { ...process.env, HEYGEN_CONFIG_DIR: dir };
    env.HEYGEN_API_BASE ||= apiBaseUrl();
    if (credential?.type === "oauth") {
      const host = new URL(env.HEYGEN_API_BASE).hostname;
      if (host !== "heygen.com" && !host.endsWith(".heygen.com")) {
        throw new AuthError(
          "OAUTH_NOT_CONFIGURED",
          "A media gateway requires its own API credential",
        );
      }
      delete env.HEYGEN_API_KEY;
      delete env.HYPERFRAMES_API_KEY;
      env.HEYGEN_ACCESS_TOKEN = credential.access_token;
      await writeStore(
        {
          oauth: {
            access_token: credential.access_token,
            expires_at: credential.expires_at?.toISOString(),
            token_type: "Bearer",
          },
        },
        join(dir, "credentials"),
      );
    } else if (credential?.type === "api_key") {
      env.HEYGEN_API_KEY = credential.key;
      delete env.HEYGEN_ACCESS_TOKEN;
    } else {
      delete env.HEYGEN_ACCESS_TOKEN;
      delete env.HEYGEN_API_KEY;
      delete env.HYPERFRAMES_API_KEY;
    }
    return await run(env);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
