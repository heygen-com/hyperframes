// The decoded path after `route` ("projects/:id/preview", "composition"), cut by segment from the raw URL:
// Hono's c.req.path leaves %40 %25 %23 %26 %3F encoded, so cutting a decoded prefix out of it misses.
export function requestSubPath(url: string, route: string): string {
  const routeSegments = route.split("/");
  const segments = new URL(url).pathname.split("/");
  const start = segments.indexOf(routeSegments[0] ?? "");
  return decodeURIComponent(segments.slice(start + routeSegments.length).join("/"));
}
