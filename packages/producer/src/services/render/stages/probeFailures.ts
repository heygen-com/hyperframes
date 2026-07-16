const NETWORK_FAILURE_PATTERN = /404|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_REFUSED|net::ERR_/i;
const FAVICON_PATTERN = /(?:^|[/?])favicon(?:\.[a-z0-9]+)?(?:[?#\s]|$)/i;

export function isActionableProbeFailure(line: string): boolean {
  return NETWORK_FAILURE_PATTERN.test(line) && !FAVICON_PATTERN.test(line);
}
