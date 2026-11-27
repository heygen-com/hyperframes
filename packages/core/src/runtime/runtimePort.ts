// The runtime's MessagePort calls, bound to built-ins read when the runtime first evaluates, before any
// composition script runs. Best-effort: it covers the port, channel, event-data and container calls the
// runtime makes with a port; a built-in reached some other way after load is not covered.
const apply = Reflect.apply;
const protoOf = Object.getPrototypeOf;
const descriptor = Object.getOwnPropertyDescriptor;
const NativeMessageChannel = typeof MessageChannel !== "undefined" ? MessageChannel : null;

type Fn = (...args: never[]) => unknown;
type PortMethods = {
  proto: object;
  post: Fn;
  close: Fn;
  setOnMessage: Fn | null;
  port1: Fn | null;
  port2: Fn | null;
  eventData: Fn | null;
  eventProto: object | null;
};

function accessor(proto: object | null, name: string, kind: "get" | "set"): Fn | null {
  for (let at = proto; at; at = protoOf(at)) {
    const found = descriptor(at, name)?.[kind];
    if (found) return found as Fn;
  }
  return null;
}

// Browsers expose a channel's ports through prototype getters; Node keeps them as the channel's own data.
function channelPort(channel: MessageChannel, getter: Fn | null, name: "port1" | "port2") {
  return (getter ? apply(getter, channel, []) : descriptor(channel, name)?.value) as MessagePort;
}

const native: PortMethods | null = (() => {
  if (!NativeMessageChannel) return null;
  try {
    const probe = new NativeMessageChannel();
    const channelProto = protoOf(probe) as object;
    const port1 = accessor(channelProto, "port1", "get");
    const port2 = accessor(channelProto, "port2", "get");
    const proto = protoOf(channelPort(probe, port1, "port1")) as MessagePort;
    const methods: PortMethods = {
      proto,
      post: proto.postMessage as Fn,
      close: proto.close as Fn,
      setOnMessage: accessor(proto, "onmessage", "set"),
      port1,
      port2,
      eventData:
        typeof MessageEvent !== "undefined"
          ? accessor(MessageEvent.prototype, "data", "get")
          : null,
      eventProto: typeof MessageEvent !== "undefined" ? MessageEvent.prototype : null,
    };
    apply(methods.close, channelPort(probe, port1, "port1"), []);
    apply(methods.close, channelPort(probe, port2, "port2"), []);
    return methods;
  } catch {
    return null;
  }
})();

// A stand-in object (tests) keeps its own methods; a browser port always gets the bound ones.
const bound = (port: MessagePort) => (native && protoOf(port) === native.proto ? native : null);

export function createRuntimeChannel(): { port1: MessagePort; port2: MessagePort } {
  const channel = new (NativeMessageChannel ?? MessageChannel)();
  if (!native) return { port1: channel.port1, port2: channel.port2 };
  return {
    port1: channelPort(channel, native.port1, "port1"),
    port2: channelPort(channel, native.port2, "port2"),
  };
}

export function postOnPort(port: MessagePort, message: unknown, transfer?: Transferable[]): void {
  const methods = bound(port);
  if (methods) apply(methods.post, port, [message, transfer ?? []]);
  else if (transfer) port.postMessage(message, transfer);
  else port.postMessage(message);
}

export function onPortMessage(port: MessagePort, handler: (data: unknown) => void): void {
  const methods = bound(port);
  const read = methods?.eventData;
  const dataOf = (event: MessageEvent<unknown>) =>
    read && protoOf(event) === methods?.eventProto ? apply(read, event, []) : event.data;
  const onMessage = (event: MessageEvent<unknown>) => handler(dataOf(event));
  if (methods?.setOnMessage) apply(methods.setOnMessage, port, [onMessage]);
  else port.onmessage = onMessage;
}

export function closePort(port: MessagePort): void {
  const methods = bound(port);
  if (methods) apply(methods.close, port, []);
  else port.close();
}

const mapGet = Map.prototype.get;
const mapSet = Map.prototype.set;
const mapHas = Map.prototype.has;
const mapDelete = Map.prototype.delete;
const mapClear = Map.prototype.clear;
const mapForEach = Map.prototype.forEach;
const mapSize = accessor(Map.prototype, "size", "get")!;

/** A Map keyed by ports whose calls never reach a patched Map.prototype. */
export interface PortMap<V> {
  get(port: MessagePort): V | undefined;
  set(port: MessagePort, value: V): void;
  has(port: MessagePort): boolean;
  delete(port: MessagePort): boolean;
  clear(): void;
  forEach(each: (value: V, port: MessagePort) => void): void;
  size(): number;
}

export function portMap<V>(): PortMap<V> {
  const map = new Map<MessagePort, V>();
  return {
    get: (port) => apply(mapGet, map, [port]) as V | undefined,
    set: (port, value) => void apply(mapSet, map, [port, value]),
    has: (port) => apply(mapHas, map, [port]) as boolean,
    delete: (port) => apply(mapDelete, map, [port]) as boolean,
    clear: () => void apply(mapClear, map, []),
    forEach: (each) => void apply(mapForEach, map, [each]),
    size: () => apply(mapSize, map, []) as number,
  };
}
