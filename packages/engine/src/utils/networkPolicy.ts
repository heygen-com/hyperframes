import { BlockList, isIP } from "node:net";

export type NonPublicIPv4Class =
  | "loopback"
  | "private"
  | "link-local"
  | "carrier-grade"
  | "reserved";

// The one list of special-use networks: asset downloads and the capture proxy both read it, so a site one can reach the other can too.
const NON_PUBLIC_IPV4_ADDRESSES = new BlockList();
const IPV4_CLASSES = new Map<NonPublicIPv4Class, BlockList>();
for (const [network, prefix, hostClass] of [
  ["0.0.0.0", 8, "loopback"],
  ["10.0.0.0", 8, "private"],
  ["100.64.0.0", 10, "carrier-grade"],
  ["127.0.0.0", 8, "loopback"],
  ["169.254.0.0", 16, "link-local"],
  ["172.16.0.0", 12, "private"],
  ["192.0.0.0", 24, "reserved"],
  ["192.0.2.0", 24, "reserved"],
  ["192.88.99.0", 24, "reserved"],
  ["192.168.0.0", 16, "private"],
  ["198.18.0.0", 15, "reserved"],
  ["198.51.100.0", 24, "reserved"],
  ["203.0.113.0", 24, "reserved"],
  ["224.0.0.0", 4, "reserved"],
  ["240.0.0.0", 4, "reserved"],
] as const) {
  NON_PUBLIC_IPV4_ADDRESSES.addSubnet(network, prefix, "ipv4");
  if (!IPV4_CLASSES.has(hostClass)) IPV4_CLASSES.set(hostClass, new BlockList());
  IPV4_CLASSES.get(hostClass)!.addSubnet(network, prefix, "ipv4");
}

export function ipv4HostClass(address: string): NonPublicIPv4Class | "public" {
  for (const [hostClass, list] of IPV4_CLASSES) if (list.check(address, "ipv4")) return hostClass;
  return inOperatorRange(address, "ipv4") ? "private" : "public";
}

const OPERATOR_RANGES_ENV = "PRODUCER_NON_PUBLIC_CIDRS";
let operatorRangesFor: string | undefined;
let operatorRangeList: BlockList | "malformed" = new BlockList();

function operatorRanges(): BlockList | "malformed" {
  const raw = process.env[OPERATOR_RANGES_ENV] ?? "";
  if (raw === operatorRangesFor) return operatorRangeList;
  operatorRangesFor = raw;
  operatorRangeList = parseRanges(raw);
  if (operatorRangeList === "malformed") {
    console.warn(
      `[hyperframes] ${OPERATOR_RANGES_ENV}="${raw}" is not a list like 192.160.0.0/16; every address is refused.`,
    );
  }
  return operatorRangeList;
}

function parseRanges(raw: string): BlockList | "malformed" {
  const list = new BlockList();
  for (const range of raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)) {
    const [network = "", bits] = range.split("/");
    const family = isIP(network);
    const prefix = Number(bits);
    const max = family === 4 ? 32 : 128;
    if (
      family === 0 ||
      bits === undefined ||
      !Number.isInteger(prefix) ||
      prefix < 0 ||
      prefix > max
    ) {
      return "malformed";
    }
    list.addSubnet(network, prefix, family === 4 ? "ipv4" : "ipv6");
  }
  return list;
}

function inOperatorRange(address: string, family: "ipv4" | "ipv6"): boolean {
  const ranges = operatorRanges();
  return ranges === "malformed" || ranges.check(address, family);
}

const MAPPED_OR_NAT64_IPV6 = new BlockList();
MAPPED_OR_NAT64_IPV6.addSubnet("::ffff:0:0", 96, "ipv6");
MAPPED_OR_NAT64_IPV6.addSubnet("64:ff9b::", 96, "ipv6");

function embeddedIPv4(address: string): string | undefined {
  const tail = address.slice(address.lastIndexOf(":") + 1);
  if (isIP(tail) === 4) return tail;
  const [head = "", rest] = address.split("::");
  const left = head ? head.split(":") : [];
  const right = rest ? rest.split(":") : [];
  const groups = [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  if (groups.length !== 8) return undefined;
  const [high, low] = groups.slice(6).map((group) => parseInt(group, 16));
  if (!Number.isInteger(high) || !Number.isInteger(low)) return undefined;
  return [high! >> 8, high! & 255, low! >> 8, low! & 255].join(".");
}

export function carriedIPv4(address: string): string | undefined {
  return MAPPED_OR_NAT64_IPV6.check(address, "ipv6") ? embeddedIPv4(address) : undefined;
}

const NON_PUBLIC_IPV6_ADDRESSES = new BlockList();
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
  ["64:ff9b:1::", 48],
] as const) {
  NON_PUBLIC_IPV6_ADDRESSES.addSubnet(network, prefix, "ipv6");
}

/** Literal-host policy shared by rendering and capture; DNS resolution remains trusted. */
export function isBlockedNetworkHost(hostname: string): boolean {
  const h = hostname
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^\[|\]$/g, "");
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal")
  )
    return true;
  const addressType = isIP(h);
  if (addressType === 0) return false;
  if (inOperatorRange(h, addressType === 4 ? "ipv4" : "ipv6")) return true;
  if (addressType === 6 && MAPPED_OR_NAT64_IPV6.check(h, "ipv6")) {
    const ipv4 = carriedIPv4(h);
    return ipv4 === undefined || isBlockedNetworkHost(ipv4);
  }
  return addressType === 4
    ? NON_PUBLIC_IPV4_ADDRESSES.check(h, "ipv4")
    : NON_PUBLIC_IPV6_ADDRESSES.check(h, "ipv6");
}
