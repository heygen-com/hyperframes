/** Registry hosts may be private; authenticate the HTTPS transport, not public IP reachability. */
export function registryHttpsUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error(
      "Registry URLs must be an absolute https:// URL without credentials or fragments",
    );
  }
  return url;
}

export function registryPathUrl(base: string, ...parts: string[]): string {
  const url = registryHttpsUrl(base);
  if (url.search) throw new Error("Registry base URL must not contain a query");
  const segments = parts.flatMap((part) => part.split("/"));
  if (
    segments.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        part.includes("\\") ||
        Array.from(part).some((char) => char.charCodeAt(0) < 32),
    )
  ) {
    throw new Error("Unsafe registry source path");
  }
  url.pathname = url.pathname.replace(/\/$/, "") + "/" + segments.map(encodeURIComponent).join("/");
  return url.href;
}

export async function fetchRegistryHttps(value: string, signal: AbortSignal): Promise<Response> {
  let url = registryHttpsUrl(value);
  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await fetch(url.href, { signal, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) throw new Error("Registry redirect has no location");
    url = registryHttpsUrl(new URL(location, url).href);
  }
  throw new Error("Too many registry redirects");
}
