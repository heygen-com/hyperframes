// The runtime's MessagePort calls, bound to the browser's own methods when the runtime first evaluates,
// before any composition script runs, so a later change to MessagePort.prototype never sees a runtime port.
type PortMethods = {
  proto: object;
  post: (this: MessagePort, message: unknown, transfer: Transferable[]) => void;
  close: (this: MessagePort) => void;
  setOnMessage:
    | ((this: MessagePort, handler: (event: MessageEvent<unknown>) => void) => void)
    | null;
};

const NativeMessageChannel = typeof MessageChannel !== "undefined" ? MessageChannel : null;

function accessorSetter(proto: object | null, name: string) {
  for (let at = proto; at; at = Object.getPrototypeOf(at)) {
    const setter = Object.getOwnPropertyDescriptor(at, name)?.set;
    if (setter) return setter;
  }
  return null;
}

const native: PortMethods | null = (() => {
  if (!NativeMessageChannel) return null;
  try {
    const probe = new NativeMessageChannel();
    const proto = Object.getPrototypeOf(probe.port1) as MessagePort;
    const methods = {
      proto,
      post: proto.postMessage,
      close: proto.close,
      setOnMessage: accessorSetter(proto, "onmessage"),
    };
    methods.close.call(probe.port1);
    methods.close.call(probe.port2);
    return methods;
  } catch {
    return null;
  }
})();

// A stand-in object (tests) keeps its own methods; a browser port always gets the bound ones.
const bound = (port: MessagePort) =>
  native && Object.getPrototypeOf(port) === native.proto ? native : null;

export function createRuntimeChannel(): MessageChannel {
  return new (NativeMessageChannel ?? MessageChannel)();
}

export function postOnPort(port: MessagePort, message: unknown, transfer?: Transferable[]): void {
  const methods = bound(port);
  if (methods) methods.post.call(port, message, transfer ?? []);
  else if (transfer) port.postMessage(message, transfer);
  else port.postMessage(message);
}

export function onPortMessage(
  port: MessagePort,
  handler: (event: MessageEvent<unknown>) => void,
): void {
  const setOnMessage = bound(port)?.setOnMessage;
  if (setOnMessage) setOnMessage.call(port, handler);
  else port.onmessage = handler;
}

export function closePort(port: MessagePort): void {
  const methods = bound(port);
  if (methods) methods.close.call(port);
  else port.close();
}
