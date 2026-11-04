import { createSocket } from "node:dgram";

export interface TestDnsServer {
  /** `host:port`, for a Resolver's setServers. */
  address: string;
  close(): void;
}

/** A DNS server: "silent" never replies, "answer" answers A with `ipv4`, "no-aaaa" answers A and drops AAAA. */
export async function startTestDnsServer(
  mode: "silent" | "answer" | "no-aaaa",
  ipv4 = "127.0.0.1",
): Promise<TestDnsServer> {
  const socket = createSocket("udp4");
  socket.on("message", (msg, peer) => {
    if (mode === "silent") return;
    let end = 12;
    while (msg[end] !== 0) end += (msg[end] ?? 0) + 1;
    end += 5;
    const isA = msg.readUInt16BE(end - 4) === 1;
    if (mode === "no-aaaa" && !isA) return;
    const header = Buffer.alloc(12);
    msg.copy(header, 0, 0, 2);
    header.writeUInt16BE(0x8180, 2);
    header.writeUInt16BE(1, 4);
    header.writeUInt16BE(isA ? 1 : 0, 6);
    const answer = Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4]);
    const record = Buffer.concat([answer, Buffer.from(ipv4.split(".").map(Number))]);
    socket.send(
      Buffer.concat([header, msg.subarray(12, end), ...(isA ? [record] : [])]),
      peer.port,
      peer.address,
    );
  });
  await new Promise<void>((resolve) => socket.bind(0, "127.0.0.1", resolve));
  return { address: `127.0.0.1:${socket.address().port}`, close: () => socket.close() };
}
