/**
 * Public surface of the auth library — only the symbols the auth
 * commands consume today. Internal types stay in their source files.
 */

export { isAuthError } from "./errors.js";

export {
  clearOAuth,
  deleteStore,
  hasPreservedUnknownData,
  isHeaderSafe,
  readStore,
  writeStore,
} from "./store.js";
export type { Credentials, StoredUserInfo } from "./store.js";

export {
  clearUserInfo,
  isUserInfoEmpty,
  loadUserInfo,
  saveUserInfo,
  userDisplayName,
} from "./user.js";

export { configDir, credentialPath } from "./paths.js";

export { tryResolveCredential } from "./resolver.js";
export type { ResolvedCredential } from "./resolver.js";

export { AuthClient } from "./client.js";
export type { UserInfo } from "./client.js";

export {
  assertOAuthConfiguredOrExit,
  refreshTokens,
  revokeTokens,
  startAuthorizationCodeFlow,
} from "./oauth.js";
