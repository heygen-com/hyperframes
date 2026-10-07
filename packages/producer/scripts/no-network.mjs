import dns from "node:dns";

// Unit tests run offline: fetch throws, and a lookup of any host but this machine fails, which also covers a test
// environment's own fetch (happy-dom's) and node:http. A test that needs a response stubs fetch itself.
const LOCAL = new Set(["localhost"]);
const refusal = (target) => new TypeError(`No network in unit tests: ${target}`);

globalThis.fetch = async (input) => {
  throw refusal(input?.url ?? input);
};

const { lookup } = dns;
const guarded = (host, ...rest) =>
  LOCAL.has(host) ? lookup(host, ...rest) : process.nextTick(rest.at(-1), refusal(host));
// Keeps the original's own properties, among them what util.promisify reads to resolve { address, family }.
dns.lookup = Object.defineProperties(guarded, Object.getOwnPropertyDescriptors(lookup));
