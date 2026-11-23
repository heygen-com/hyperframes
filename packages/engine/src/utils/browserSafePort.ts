import type { AddressInfo, Server } from "node:net";

// Chromium refuses to load from these ports (net::ERR_UNSAFE_PORT); net/base/port_util.cc kRestrictedPorts.
const RESTRICTED_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102,
  103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465,
  512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993,
  995, 1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669,
  6697, 10080,
]);

const MAX_ATTEMPTS = 32;

export const isBrowserSafePort = (port: number): boolean => !RESTRICTED_PORTS.has(port);

type Bindable = Pick<Server, "address" | "close" | "listen" | "once" | "off">;

function listenOnce(server: Bindable, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      server.off("error", reject);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

function closeServer(server: Bindable): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

/** Rebinds an already-listening server until the OS hands it a port a browser will load from. */
export async function settleOnBrowserSafePort(server: Bindable, host: string): Promise<number> {
  let port = (server.address() as AddressInfo).port;
  for (let attempt = 1; !isBrowserSafePort(port); attempt++) {
    if (attempt >= MAX_ATTEMPTS)
      throw new Error(`The OS kept offering browser-restricted ports (last: ${port}).`);
    await closeServer(server);
    port = await listenOnce(server, host);
  }
  return port;
}

/** `server.listen(0, host)` that never lands on a port Chromium blocks; resolves to the bound port. */
export async function listenOnBrowserSafePort(server: Bindable, host: string): Promise<number> {
  await listenOnce(server, host);
  return settleOnBrowserSafePort(server, host);
}
