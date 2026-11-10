/** Read for each request, so a share that outlives a token meets the renewed one; pass a bearer a server refused.
 * `owner` is the account the token is (accountPrincipal), for what is counted per account. */
/** `orOffline`: a saved sign-in whose renewal could not reach HeyGen throws AccountUnreachable instead of null. */
export type ApiAccess = (
  refused?: string,
  orOffline?: boolean,
) => Promise<{
  token: string;
  owner: string | null;
  heygen: string;
  heygenApi: string;
} | null>;
