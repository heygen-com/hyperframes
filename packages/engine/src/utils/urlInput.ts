import { existsSync } from "node:fs";
import { redactUrlQueryStrings } from "@hyperframes/core";
import {
  SELF_CONTAINED_FORMATS,
  assertLiteralMediaInput,
  mediaInputArgs,
} from "@hyperframes/parsers/ff-binaries";
import { resolveRestrictPageNetwork } from "../config.js";
import { getFfmpegBinary, getFfprobeBinary } from "./ffmpegBinaries.js";

// The Lambda nodejs image (Amazon Linux 2023) ships the first; Debian/Ubuntu the second; macOS the third.
const CA_BUNDLES = [
  "/etc/pki/tls/certs/ca-bundle.crt",
  "/etc/ssl/certs/ca-certificates.crt",
  "/etc/ssl/cert.pem",
];

// Lambda's ffprobe 4.0 accepts these but not -reconnect_on_network_error; a stalled read fails after 30 s.
const RECONNECT_ARGS = ["-rw_timeout", "30000000", "-reconnect", "1", "-reconnect_delay_max", "2"];

const contentAddressedUrls = new Map<string, string>();
const withoutQuery = (url: string) => url.split(/[?#]/, 1)[0] ?? url;

/** An operator's file whose path holds its hash: probes of it are cacheable, and it is read without the proxy. */
export function declareContentAddressedUrl(url: string, sha256: string): void {
  contentAddressedUrls.set(withoutQuery(url), sha256);
}

export function contentAddressedSha256(url: string): string | undefined {
  return contentAddressedUrls.get(withoutQuery(url));
}

/** A URL scheme ffmpeg opens itself (2+ letters, so `C:\` stays a path); `subfile,` names the URL it opens. */
const SCHEME = /^([a-z][a-z0-9+.-]+):/i;
const PROXIED_PROTOCOLS = "http,https,tls,tcp,httpproxy";
const ROUTES = new Map<string, "local" | "proxy">([
  ["file", "local"],
  ["http", "proxy"],
  ["https", "proxy"],
]);

function schemeRoute(input: string): "local" | "proxy" {
  const scheme = /^subfile,/i.test(input) ? "subfile" : SCHEME.exec(input)?.[1]?.toLowerCase();
  const route = scheme === undefined ? "local" : ROUTES.get(scheme);
  if (route) return route;
  const where = resolveRestrictPageNetwork() ? " with a restricted page network" : "";
  throw new Error(`[FFmpeg] a ${scheme}: input is not read${where}`);
}

function restrictedRoute(input: string): "local" | "declared" | "proxy" {
  const route = schemeRoute(input);
  return route === "proxy" && /^https:/i.test(input) && contentAddressedSha256(input)
    ? "declared"
    : route;
}

export function selfContainedFormatArgs(): string[] {
  return resolveRestrictPageNetwork() ? ["-format_whitelist", SELF_CONTAINED_FORMATS] : [];
}

/** Every input of composition media reads only demuxers that open nothing by themselves. ffmpeg and ffprobe skip TLS certificate checks unless told to; an https input must be verified, and on a render service be a self-contained container that names only HTTPS. */
export function urlInputArgs(
  input: string,
  {
    tool = "ffmpeg",
    caBundles = CA_BUNDLES,
  }: { tool?: "ffmpeg" | "ffprobe"; caBundles?: readonly string[] } = {},
): string[] {
  assertLiteralMediaInput(input);
  const mediaFormats = () =>
    mediaInputArgs(tool === "ffprobe" ? getFfprobeBinary() : getFfmpegBinary(), input, {
      playlists: true,
    });
  const restricted = resolveRestrictPageNetwork();
  const route = restricted ? restrictedRoute(input) : undefined;
  if (route === "proxy" && !/^https:\/\//i.test(input))
    return [
      ...RECONNECT_ARGS,
      ...networkRetryFor(tool),
      ...proxiedLimits(),
      ...PROXY_THAT_REACHES_NOTHING,
    ];
  if ((route ?? schemeRoute(input)) === "local") return mediaFormats();
  if (!/^https:\/\//i.test(input)) return mediaFormats();
  const caFile = caBundles.find((path) => existsSync(path));
  if (!caFile) {
    throw new Error(
      `[FFmpeg] cannot verify TLS for an https input: no CA bundle at ${caBundles.join(", ")}`,
    );
  }
  const networkRetry = networkRetryFor(tool);
  const renderServiceLimits =
    route === "proxy"
      ? [...proxiedLimits(), ...PROXY_THAT_REACHES_NOTHING]
      : restricted
        ? ["-protocol_whitelist", "https,tls,tcp", ...selfContainedFormatArgs()]
        : mediaFormats();
  return [
    "-tls_verify",
    "1",
    "-ca_file",
    caFile,
    ...RECONNECT_ARGS,
    ...networkRetry,
    ...renderServiceLimits,
  ];
}

const networkRetryFor = (tool: "ffmpeg" | "ffprobe") =>
  tool === "ffmpeg" ? ["-reconnect_on_network_error", "1"] : [];
const proxiedLimits = () => [
  "-protocol_whitelist",
  PROXIED_PROTOCOLS,
  ...selfContainedFormatArgs(),
];
const PROXY_THAT_REACHES_NOTHING = ["-http_proxy", "http://127.0.0.1:9"];

type Routed = { args: string[]; env: NodeJS.ProcessEnv; close(): Promise<void> };

/** Undefined, with nothing awaited, unless an input at `inputAt` must be read through the public-only proxy. */
export function withPublicOnlyProxy(
  args: readonly string[],
  inputAt: readonly number[],
): Promise<Routed> | undefined {
  if (!resolveRestrictPageNetwork()) return undefined;
  const proxied = inputAt.filter((at) => restrictedRoute(args[at]!) === "proxy");
  return proxied.length === 0 ? undefined : startProxyFor(args, proxied);
}

async function startProxyFor(args: readonly string[], proxied: readonly number[]): Promise<Routed> {
  const { logRefusal, startCaptureProxy } =
    await import("../services/publicNetwork/captureProxy.js");
  const proxy = await startCaptureProxy(null, logRefusal);
  const out = [...args];
  for (const at of [...proxied].sort((a, b) => b - a)) {
    const flagAt = out[at - 1] === "-i" || out[at - 1] === "--" ? at - 1 : at;
    out.splice(flagAt, 0, ...proxiedLimits(), "-http_proxy", proxy.url);
  }
  // FFmpeg before 4.4 takes an https proxy only from http_proxy, and every version skips it for a no_proxy host.
  const { no_proxy: _a, NO_PROXY: _b, ...env } = process.env;
  return { args: out, env: { ...env, http_proxy: proxy.url }, close: () => proxy.close() };
}

export const ffmpegInputIndexes = (args: readonly string[]): number[] =>
  args.flatMap((arg, at) => (arg === "-i" && at + 1 < args.length ? [at + 1] : []));

/** A signed URL grants access until it expires: strip query strings from every string field of an error and its causes. */
export function redactUrlQueriesInError<T>(error: T): T {
  if (!(error instanceof Error)) return error;
  const fields = error as unknown as Record<string, unknown>;
  for (const key of ["message", "stack", ...Object.keys(error)]) {
    if (typeof fields[key] === "string") fields[key] = redactUrlQueryStrings(fields[key]);
  }
  if (error.cause !== error) redactUrlQueriesInError(error.cause);
  return error;
}
