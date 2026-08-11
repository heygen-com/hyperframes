const HEYGEN_ROUTE_HEADER = "heygen_route";
const HEYGEN_CANARY_ROUTE = "canary";

/** Route CLI-owned HeyGen API calls through the EF canary deployment. */
export function withHeygenCanaryRoute(
  headers: Record<string, string> = {},
): Record<string, string> {
  return { ...headers, [HEYGEN_ROUTE_HEADER]: HEYGEN_CANARY_ROUTE };
}
