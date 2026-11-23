import type { DeRouterBreaker, DeRouterRevert } from "../../telemetry/config.js";

/** Router renders a lone strike stays remembered, and clean renders an off router waits. */
export const DE_ROUTER_BREAKER_WINDOW = 20;

/** The one owner of when the router goes off for an install and when it comes back. */
export function isRouterOff(breaker: DeRouterBreaker | undefined, version: string): boolean {
  return breaker?.trip !== undefined && breaker.trip.version === version;
}

export function afterRevert(
  breaker: DeRouterBreaker | undefined,
  revert: DeRouterRevert,
): DeRouterBreaker {
  const strike = breaker?.strike;
  const second =
    strike !== undefined && revert.atRender - strike.atRender < DE_ROUTER_BREAKER_WINDOW;
  return second ? { trip: { ...revert, cleanRenders: 0 } } : { strike: revert };
}

export function afterCleanRender(
  breaker: DeRouterBreaker | undefined,
): DeRouterBreaker | undefined {
  const trip = breaker?.trip;
  if (trip === undefined) return breaker;
  if (trip.cleanRenders + 1 >= DE_ROUTER_BREAKER_WINDOW) return undefined;
  return { trip: { ...trip, cleanRenders: trip.cleanRenders + 1 } };
}

/** Drops what another CLI version recorded. */
export function forVersion(
  breaker: DeRouterBreaker | undefined,
  version: string,
): DeRouterBreaker | undefined {
  if (breaker?.trip !== undefined) return breaker.trip.version === version ? breaker : undefined;
  return breaker?.strike?.version === version ? breaker : undefined;
}
