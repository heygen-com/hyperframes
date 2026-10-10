import { isIP } from "node:net";

type ProxyEnvironment = Readonly<Record<string, string | undefined>>;

function validProxyEndpoint(url: URL): boolean {
  return (
    ["http:", "https:", "socks4:", "socks5:"].includes(url.protocol) &&
    url.hostname !== "" &&
    !/[;,]/.test(url.host) &&
    ["", "/"].includes(url.pathname) &&
    url.search === "" &&
    url.hash === ""
  );
}

function proxySetting(env: ProxyEnvironment, name: string): string | undefined {
  const setting = env[name.toLowerCase()] ?? env[name];
  if (setting === undefined) return undefined;
  const value = setting.trim();
  if (value === "") return undefined;
  let url: URL;
  try {
    url = new URL(value.includes("://") ? value : `http://${value}`);
  } catch {
    throw new Error(`${name} must be a valid proxy URL.`);
  }
  if (url.username !== "" || url.password !== "") {
    throw new Error(
      `${name} contains proxy credentials. Chrome ignores embedded credentials; use a proxy without URL credentials.`,
    );
  }
  if (!validProxyEndpoint(url)) {
    throw new Error(
      `${name} must be an HTTP, HTTPS, SOCKS4 or SOCKS5 proxy URL without a path, query or fragment.`,
    );
  }
  return `${url.protocol}//${url.host}`;
}

function bypassRules(host: string): string[] {
  if (isIP(host) === 6) return [`[${host}]`];
  if (isIP(host.replace(/:\d+$/, "")) !== 0 || /[/*<[]/.test(host)) return [host];
  const domain = host.replace(/^\./, "");
  return [domain, `.${domain}`];
}

export function resolveChromeProxyArgs(env: ProxyEnvironment): string[] {
  const all = proxySetting(env, "ALL_PROXY");
  const http = proxySetting(env, "HTTP_PROXY") ?? all;
  const https = proxySetting(env, "HTTPS_PROXY") ?? all;
  const servers: string[] = [];
  if (http !== undefined) servers.push(`http=${http}`);
  if (https !== undefined) servers.push(`https=${https}`);
  if (all !== undefined) servers.push(`socks=${all}`);
  if (servers.length === 0) return [];
  const exclusions = (env.no_proxy ?? env.NO_PROXY ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter((host) => host !== "")
    .flatMap(bypassRules);
  const loopback = ["localhost", "127.0.0.1", "[::1]"];
  const bypass = [...new Set(exclusions.filter((host) => !loopback.includes(host))), ...loopback];
  return [`--proxy-server=${servers.join(";")}`, `--proxy-bypass-list=${bypass.join(";")}`];
}
