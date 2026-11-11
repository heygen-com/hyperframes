/**
 * The runtime's end of the editing channel (wire types in `editingPort.ts`).
 *
 * The port goes to `window.parent` once, when the parent asks for it, so only
 * the parent holds a channel. A connect posted by anything else, including the
 * page itself, is ignored and does not use up the handoff. Requests on the port
 * are validated before they run; a bad one gets a typed error reply, never a throw.
 */
import { swallow } from "./diagnostics";
import {
  EDITING_CONNECT,
  EDITING_PORT,
  EDITING_PROTOCOL_VERSION,
  EDITING_REQUEST_KINDS,
  isPlainRecord,
  parseEditingRequest,
  type EditingParams,
  type EditingReply,
  type EditingRequestKind,
  type EditingResult,
} from "./editingPort";
import type { ClipNode } from "./clipTree";

type Handlers = {
  [K in EditingRequestKind]: (
    params: EditingParams<K>,
  ) => EditingResult<K> | Promise<EditingResult<K>>;
};

function clipParents(nodes: readonly ClipNode[], out: Array<[string, string]> = []) {
  for (const node of nodes) {
    if (node.id && node.parentId) out.push([node.id, node.parentId]);
    clipParents(node.children, out);
  }
  return out;
}

const HANDLERS: Handlers = {
  hello: () => ({ version: EDITING_PROTOCOL_VERSION, kinds: [...EDITING_REQUEST_KINDS] }),
  "runtime-snapshot": () => ({
    playerReady: Boolean(window.__player),
    startupError: typeof window.__hfStartupError === "string" ? window.__hfStartupError : null,
    clipManifest: window.__clipManifest ?? null,
    clipParents: clipParents(window.__clipTree?.roots ?? []),
  }),
  "wait-for-seek": async () => {
    const wait = window.__hfWaitForSeekCompletion;
    if (typeof wait !== "function") return { waited: false };
    await wait();
    return { waited: true };
  },
  "set-loop-start": ({ seconds }) => {
    const setLoopStart = window.__hf?.setLoopStart;
    if (typeof setLoopStart !== "function") return { applied: false };
    setLoopStart(seconds);
    return { applied: true };
  },
};

function serve(port: MessagePort): void {
  const reply = (message: EditingReply) => {
    try {
      port.postMessage(message);
    } catch (err) {
      // A result that cannot be cloned still owes the parent an answer.
      if (message.ok) reply(failure(message.id, err));
      else swallow("editingAgent.reply", err);
    }
  };
  port.onmessage = (event: MessageEvent<unknown>) => {
    const request = parseEditingRequest(event.data);
    if (!request.ok) {
      reply({
        v: EDITING_PROTOCOL_VERSION,
        id: request.id,
        ok: false,
        error: { code: request.code, message: request.message },
      });
      return;
    }
    const handler = HANDLERS[request.kind] as (params: unknown) => unknown;
    Promise.resolve()
      .then(() => handler(request.params))
      .then(
        (result) => reply({ v: EDITING_PROTOCOL_VERSION, id: request.id, ok: true, result }),
        (err: unknown) => reply(failure(request.id, err)),
      );
  };
}

function failure(id: number, err: unknown): EditingReply {
  const message = err instanceof Error ? err.message : String(err);
  return {
    v: EDITING_PROTOCOL_VERSION,
    id,
    ok: false,
    error: { code: "failed", message: message.slice(0, 500) },
  };
}

export function installEditingAgent(parent: Window = window.parent): { dispose: () => void } {
  let port: MessagePort | null = null;
  const onMessage = (event: MessageEvent<unknown>) => {
    // A top-level page is its own parent, so a self-post would pass the source check.
    if (parent === window || event.source !== parent) return;
    const data = event.data;
    if (!isPlainRecord(data) || data.source !== "hf-parent" || data.type !== EDITING_CONNECT)
      return;
    if (data.v !== EDITING_PROTOCOL_VERSION) return;
    window.removeEventListener("message", onMessage);
    const channel = new MessageChannel();
    port = channel.port1;
    serve(port);
    try {
      // "*" as every runtime post does (bridge.ts): the frame is not told its parent's origin.
      parent.postMessage(
        { source: "hf-preview", type: EDITING_PORT, v: EDITING_PROTOCOL_VERSION },
        "*",
        [channel.port2],
      );
    } catch (err) {
      swallow("editingAgent.handoff", err);
      port.close();
    }
  };
  window.addEventListener("message", onMessage);
  return {
    dispose() {
      window.removeEventListener("message", onMessage);
      port?.close();
    },
  };
}
