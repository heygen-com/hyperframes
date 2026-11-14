/** The project-relative path a render file server URL path names: each segment decoded, as the browser encoded it. */
export function servedPath(urlPath: string): string {
  return urlPath
    .replace(/^\//, "")
    .split("/")
    .map((seg) => {
      try {
        return decodeURIComponent(seg);
      } catch {
        return seg;
      }
    })
    .join("/");
}
