import net from "node:net";

// Unit tests run offline: fetch throws, and so does a socket to another host, which also covers a test environment's
// own fetch (happy-dom's) and node:http. A test that needs a response stubs fetch itself.
const LOCAL = new Set(["localhost", "127.0.0.1", "::1"]);
const refuse = (target) => {
  throw new TypeError(`No network in unit tests: ${target}`);
};

globalThis.fetch = async (input) => refuse(input?.url ?? input);

const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  // (options), (path) and (port, host), each optionally with a callback; Node passes them on as one array.
  const call = Array.isArray(args[0]) ? args[0] : args;
  const [first, second] = call;
  const host =
    typeof first === "object" ? (first.path ? undefined : (first.host ?? "localhost")) : second;
  if (typeof first !== "string" && typeof host === "string" && !LOCAL.has(host)) refuse(host);
  return connect.apply(this, args);
};
