import { existsSync } from "node:fs";
import { decodedUrlPath, decodeWellFormedEscapes } from "@hyperframes/parsers/asset-paths";
import { resolveWithinProject } from "./safePath.js";
export { decodeWellFormedEscapes } from "@hyperframes/parsers/asset-paths";

// The decoded path after `route` ("projects/:id/preview", "composition"), cut by segment from the raw URL:
// Hono's c.req.path leaves %40 %25 %23 %26 %3F encoded, so cutting a decoded prefix out of it misses.
export function requestSubPath(url: string, route: string): string {
  const routeSegments = route.split("/");
  const segments = new URL(url).pathname.split("/");
  const start = segments.indexOf(routeSegments[0] ?? "");
  return decodeWellFormedEscapes(segments.slice(start + routeSegments.length).join("/"));
}

// A project file a request names: the literal name when that file exists, otherwise the field read as a URL.
export function requestedProjectPath(projectDir: string, field: string): string {
  const trimmed = field.trim().replace(/^[.]\//, "");
  const named = resolveWithinProject(projectDir, trimmed);
  return named && existsSync(named) ? trimmed : decodedUrlPath(trimmed);
}
