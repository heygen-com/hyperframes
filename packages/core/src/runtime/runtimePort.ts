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
  setOnMessage: Fn;
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
    const setOnMessage = accessor(proto, "onmessage", "set");
    const eventProto = typeof MessageEvent !== "undefined" ? MessageEvent.prototype : null;
    const eventData = accessor(eventProto, "data", "get");
    if (!setOnMessage) return null;
    const methods: PortMethods = {
      proto,
      post: proto.postMessage as Fn,
      close: proto.close as Fn,
      setOnMessage,
      port1,
      port2,
      eventData,
      eventProto,
    };
    apply(methods.close, channelPort(probe, port1, "port1"), []);
    apply(methods.close, channelPort(probe, port2, "port2"), []);
    return methods;
  } catch {
    return null;
  }
})();

let standIns = false;

/** Tests only: stand-in ports and events from another realm (jsdom over Node) keep their own methods. */
export function allowPortStandInsForTests(): void {
  standIns = true;
}

function bound(port: MessagePort): PortMethods | null {
  if (native && protoOf(port) === native.proto) return native;
  if (standIns) return null;
  throw new Error("not a runtime port");
}

const eventPorts = accessor(native?.eventProto ?? null, "ports", "get");
const stopImmediate =
  typeof Event !== "undefined" ? Event.prototype.stopImmediatePropagation : null;

export function endMessageAndTakePorts(event: MessageEvent<unknown>): readonly MessagePort[] {
  if (stopImmediate) apply(stopImmediate, event, []);
  else event.stopImmediatePropagation();
  const own = !!native && !!eventPorts && protoOf(event) === native.eventProto;
  if (own) return apply(eventPorts!, event, []) as readonly MessagePort[];
  return standIns ? event.ports : [];
}

/** False when the browser's own port methods could not be read at load: the agent then never serves. */
export function canServePorts(event: MessageEvent<unknown>): boolean {
  if (standIns) return true;
  return !!native?.eventData && event.isTrusted;
}

export function postOnPort(port: MessagePort, message: unknown, transfer?: Transferable[]): void {
  const methods = bound(port);
  if (methods) apply(methods.post, port, [message, transfer ?? []]);
  else if (transfer) port.postMessage(message, transfer);
  else port.postMessage(message);
}

export function onPortMessage(port: MessagePort, handler: (data: unknown) => void): void {
  const methods = bound(port);
  const onMessage = (event: MessageEvent<unknown>) => {
    const read = native?.eventData;
    if (read && protoOf(event) === native?.eventProto) handler(apply(read, event, []));
    else if (standIns) handler(event.data);
  };
  if (methods) apply(methods.setOnMessage, port, [onMessage]);
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
