// The one answer to "is this write same origin" for the CLI server and the studio API. The Host checks here are a DNS-rebinding mitigation for browsers, not access control: a browser cannot forge Host, a local client can set it freely.
import { hostname, networkInterfaces } from "node:os";

export function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  const bracketed = /^\[([^\]]+)\]/.exec(host);
  const hostname = (bracketed ? bracketed[1] : host.split(":")[0])?.toLowerCase() ?? "";
  if (hostname === "localhost" || hostname === "::1" || hostname === "0:0:0:0:0:0:0:1") return true;
  // 127.0.0.0/8, the whole loopback block, not just 127.0.0.1.
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
}

function hostnameOf(host: string | undefined): string {
  if (!host) return "";
  const bracketed = /^\[([^\]]+)\]/.exec(host);
  return (bracketed ? bracketed[1] : host.split(":")[0])?.toLowerCase() ?? "";
}

// Names this machine answers to on a wildcard bind: interface addresses, its own hostname, the .local mDNS form, and short forms of each.
function localNames(): Set<string> {
  const names = new Set<string>();
  try {
    for (const entries of Object.values(networkInterfaces())) {
      for (const entry of entries ?? []) names.add(entry.address.toLowerCase());
    }
    const self = hostname().toLowerCase();
    if (self !== "") {
      names.add(self);
      names.add(`${self}.local`);
      const short = self.split(".")[0];
      if (short !== undefined && short !== "") {
        names.add(short);
        names.add(`${short}.local`);
      }
    }
  } catch {
    /* fail closed */
  }
  return names;
}

function hostMatchesBind(host: string | undefined, bind: string): boolean {
  const requested = hostnameOf(host);
  if (requested === "") return false;
  const bound = bind.toLowerCase();
  if (requested === bound) return true;
  return bound === "0.0.0.0" || bound === "::" || bound === "*"
    ? localNames().has(requested)
    : false;
}

// A loopback Host always passes. Any other Host passes only when the bind (HYPERFRAMES_PREVIEW_HOST) names it, or is a wildcard and the Host is a local name.
export function identityAllowed(host: string | undefined): boolean {
  if (isLoopbackHost(host)) return true;
  const bind = (process.env["HYPERFRAMES_PREVIEW_HOST"] ?? "").trim();
  if (bind === "" || isLoopbackHost(bind)) return false;
  return hostMatchesBind(host, bind);
}

function hostAllowed(host: string, allowedHosts: readonly string[] | undefined): boolean {
  if (identityAllowed(host)) return true;
  if (!allowedHosts) return false;
  const name = hostnameOf(host);
  return name !== "" && allowedHosts.some((allowed) => hostnameOf(allowed) === name);
}

function firstForwarded(value: string | undefined): string | undefined {
  const first = value?.split(",")[0]?.trim();
  return first === "" ? undefined : first;
}

function originMatches(origin: string, host: string, proto: string | undefined): boolean {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (proto !== undefined && parsed.protocol !== `${proto}:`) return false;
  return parsed.host.toLowerCase() === host.toLowerCase();
}

// proto is the scheme on the request URL the caller saw. The forwarded pair wins when a proxy supplies it: that is the origin the browser actually used. With no scheme known, an http or https origin passes.
export function sameOriginPost(headers: {
  host?: string;
  origin?: string;
  fetchSite?: string;
  proto?: string;
  forwardedProto?: string;
  forwardedHost?: string;
  allowedHosts?: readonly string[];
}): boolean {
  const host = firstForwarded(headers.forwardedHost) ?? headers.host;
  if (!host || !hostAllowed(host, headers.allowedHosts)) return false;
  if (headers.fetchSite && headers.fetchSite !== "same-origin") return false;
  if (headers.origin === undefined) return true;
  const proto = firstForwarded(headers.forwardedProto) ?? headers.proto;
  return originMatches(headers.origin, host, proto);
}
