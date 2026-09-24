// The decoded path after /projects/<id>/<route>/, cut by segment from the raw URL: Hono's c.req.path leaves
// %40 %25 %23 %26 %3F encoded, so cutting the decoded project id out of it misses.
export function projectSubPath(url: string, route: string): string {
  const segments = new URL(url).pathname.split("/");
  const rest = segments.slice(segments.indexOf("projects") + 2 + route.split("/").length);
  return decodeURIComponent(rest.join("/"));
}
