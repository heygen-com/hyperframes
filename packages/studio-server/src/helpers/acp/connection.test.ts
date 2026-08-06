import { describe, expect, it } from "vitest";
import { ndJsonStream, type Stream } from "@agentclientprotocol/sdk";
import { withAcpAgent, withAcpStream } from "./connection";

/**
 * A stand-in agent on the other end of the wire.
 *
 * `reply` returns the lines the agent writes back for one incoming message —
 * objects are encoded, strings are written verbatim so a test can send
 * something that is not JSON at all.
 */
function stubAgent(reply: (message: Record<string, any>) => Array<unknown> | undefined): Stream {
  const toAgent = new TransformStream<Uint8Array, Uint8Array>();
  const toClient = new TransformStream<Uint8Array, Uint8Array>();
  const writer = toClient.writable.getWriter();
  const encode = new TextEncoder();

  const answer = async (line: string) => {
    if (!line.trim()) return;
    for (const out of reply(JSON.parse(line)) ?? []) {
      await writer.write(encode.encode(`${typeof out === "string" ? out : JSON.stringify(out)}\n`));
    }
  };

  void (async () => {
    const reader = toAgent.readable.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      const lines = (buffer + value).split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) await answer(line);
    }
  })();

  return ndJsonStream(toAgent.writable, toClient.readable);
}

function answersInitialize(result: Record<string, unknown>) {
  return (message: Record<string, any>) =>
    message.method === "initialize" ? [{ jsonrpc: "2.0", id: message.id, result }] : undefined;
}

describe("withAcpStream", () => {
  it("returns what the agent said it can do", async () => {
    const handshake = await withAcpStream(
      stubAgent(
        answersInitialize({
          protocolVersion: 1,
          agentCapabilities: { loadSession: true, promptCapabilities: { image: true } },
          authMethods: [{ id: "oauth", name: "Sign in" }],
        }),
      ),
      {},
      async (connection) => connection.handshake,
    );

    expect(handshake.protocolVersion).toBe(1);
    expect(handshake.agentCapabilities).toEqual({
      loadSession: true,
      promptCapabilities: { image: true },
    });
    expect(handshake.authMethods).toEqual([{ id: "oauth", name: "Sign in" }]);
  });

  // Agents print startup banners and warnings. One line of prose on stdout has
  // to be survivable, or every agent that says hello is unusable.
  it("ignores a line that is not JSON", async () => {
    const handshake = await withAcpStream(
      stubAgent((message) =>
        message.method === "initialize"
          ? [
              "codex-acp 0.4.1 — starting",
              { jsonrpc: "2.0", id: message.id, result: { protocolVersion: 1 } },
            ]
          : undefined,
      ),
      {},
      async (connection) => connection.handshake,
    );

    expect(handshake.protocolVersion).toBe(1);
  });

  // The point of the protocol: two agents, different capabilities, one client.
  it.each([
    ["claude", { agentCapabilities: { loadSession: true }, authMethods: [] }],
    ["codex", { agentCapabilities: { promptCapabilities: { audio: false } }, authMethods: [] }],
  ])("connects to %s without transport-specific code", async (_name, result) => {
    const handshake = await withAcpStream(
      stubAgent(answersInitialize({ protocolVersion: 1, ...result })),
      {},
      async (connection) => connection.handshake,
    );

    expect(handshake.agentCapabilities).toEqual(result.agentCapabilities);
  });

  it("hands session updates to the caller", async () => {
    const updates: Array<Record<string, unknown>> = [];

    await withAcpStream(
      stubAgent((message) =>
        message.method === "initialize"
          ? [
              { jsonrpc: "2.0", id: message.id, result: { protocolVersion: 1 } },
              {
                jsonrpc: "2.0",
                method: "session/update",
                params: {
                  sessionId: "s1",
                  update: {
                    sessionUpdate: "agent_message_chunk",
                    content: { type: "text", text: "on it" },
                  },
                },
              },
            ]
          : undefined,
      ),
      { onUpdate: (params) => updates.push(params) },
      async () => {
        // The notification arrives after the handshake resolves; give the
        // stream a turn to deliver it before the connection closes.
        await new Promise((resolve) => setTimeout(resolve, 20));
      },
    );

    expect(updates).toEqual([
      {
        sessionId: "s1",
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "on it" } },
      },
    ]);
  });
});

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("withAcpAgent", () => {
  it("reports the exit rather than waiting out the timeout", async () => {
    await expect(
      withAcpAgent(
        { command: process.execPath, args: ["-e", "process.exit(3)"], cwd: process.cwd() },
        {},
        async (connection) => connection.handshake,
      ),
    ).rejects.toThrow(/exited with code 3 before the ACP run finished/);
  });

  it("times out on an agent that never answers, naming the command", async () => {
    await expect(
      withAcpAgent(
        // Reads stdin and says nothing: alive, connected, and useless.
        {
          command: process.execPath,
          args: ["-e", "process.stdin.resume()"],
          cwd: process.cwd(),
          handshakeTimeoutMs: 100,
        },
        {},
        async (connection) => connection.handshake,
      ),
    ).rejects.toThrow(
      new RegExp(`${escapeForRegex(process.execPath)} did not answer the ACP handshake`),
    );
  });

  it("says so when the command does not exist", async () => {
    await expect(
      withAcpAgent(
        { command: "hyperframes-no-such-agent", args: [], cwd: process.cwd() },
        {},
        async (connection) => connection.handshake,
      ),
    ).rejects.toThrow(/hyperframes-no-such-agent/);
  });
});
