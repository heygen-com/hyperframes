import { failCommand } from "../../utils/commandResult.js";
/**
 * `hyperframes auth refresh` — force-refresh the OAuth access_token
 * using the stored refresh_token.
 *
 * Mostly useful for testing the refresh path or for users on flaky
 * networks who want to pre-emptively refresh before a long render
 * job. Status's 401-retry path already does this automatically.
 */

import { defineCommand } from "citty";
import {
  assertOAuthConfiguredOrExit,
  isAuthError,
  readStore,
  refreshTokens,
} from "../../auth/index.js";
import { c } from "../../ui/colors.js";

export default defineCommand({
  meta: { name: "refresh", description: "Force-refresh the OAuth access token" },
  args: {},
  // fallow-ignore-next-line complexity
  async run() {
    assertOAuthConfiguredOrExit();

    const { credentials, source } = await readStore();
    if (source === "absent" || !credentials.oauth?.refresh_token) {
      console.error(c.warn("No OAuth refresh token to use. Run `hyperframes auth login` first."));
      failCommand();
    }

    try {
      // refreshTokens persists via oauth.ts:persistOAuth, which merges
      // into a freshly-read store (preserving api_key + any
      // refresh_token the server didn't rotate). Re-writing here would
      // use a stale snapshot and risks clobbering concurrent writes.
      await refreshTokens(credentials.oauth.refresh_token);
      console.log(c.success("✓ Refreshed OAuth access token."));
    } catch (err) {
      if (isAuthError(err) && err.code === "REFRESH_FAILED") {
        console.error(c.error(err.message));
        if (err.hint) console.error(c.dim(err.hint));
        failCommand();
      }
      throw err;
    }
  },
});
