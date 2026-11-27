// Runtime-state reads over a preview frame's editing port; an opaque frame's window is out of reach.
import {
  createEditingPortClient,
  EditingPortError,
  MAX_FONT_FACES,
  MAX_QUERY_MATCHES,
  type EditingParams,
  type EditingPortClient,
  type EditingRequestKind,
  type EditingResult,
  type TextEditSelection,
  type TextEditSelectionEvent,
} from "@hyperframes/core/runtime/editing-port";
import { isMessageList } from "@hyperframes/core/runtime/protocol";
import type { ClipManifest, IframeWindow } from "./playbackTypes";
import { MAX_FRAME_CLIPS, wellFormedClips } from "./manifestClips";
import { frameRequestSent } from "./frameFacts";

const clients = new WeakMap<HTMLIFrameElement, { client: EditingPortClient; retire: () => void }>();
const loopStarts = new WeakMap<EditingPortClient, number | null>();

/** A frame whose window refuses Studio's reads; one with no window has nothing to reach either way. */
export function previewFrameOpaque(iframe: HTMLIFrameElement): boolean {
  const win = iframe.contentWindow;
  if (!win) return false;
  try {
    void win.document;
    return false;
  } catch {
    return true;
  }
}

const beforeOtherLoadHandlers = { capture: true } as const;

/** One client per frame load: its next load disposes it, or `retirePreviewEditingClient` when the frame goes. */
export function previewEditingClient(iframe: HTMLIFrameElement): EditingPortClient {
  const open = clients.get(iframe);
  if (open) return open.client;
  const client = createEditingPortClient({ iframe });
  const onTextEditSelection = client.onTextEditSelection;
  client.onTextEditSelection = (listener) =>
    onTextEditSelection((event) => listener(frameColoursOnly(event)));
  const retire = () => {
    iframe.removeEventListener("load", retire, beforeOtherLoadHandlers);
    client.dispose();
    if (clients.get(iframe)?.client === client) clients.delete(iframe);
  };
  clients.set(iframe, { client, retire });
  iframe.addEventListener("load", retire, { ...beforeOtherLoadHandlers, once: true });
  return client;
}

function frameColoursOnly(event: TextEditSelectionEvent): TextEditSelectionEvent {
  const { selection, caret } = event;
  return {
    ...event,
    caret: caret && colourOnly(caret.color) ? caret : null,
    selection: selection && selectionColoursOnly(selection),
  };
}

export function frameStyleValue(name: string, value: unknown): string | null {
  if (typeof value !== "string" || !value || name.startsWith("--")) return null;
  const probe = document.createElement("i").style;
  probe.setProperty(name, value);
  return probe.getPropertyValue(name) ? value : null;
}

const colourOnly = (value: string | null | undefined) => frameStyleValue("color", value);

function selectionColoursOnly(selection: TextEditSelection): TextEditSelection {
  const { color, ...styles } = selection.styles;
  const agreed = colourOnly(color);
  return {
    ...selection,
    styles: agreed ? { ...styles, color: agreed } : styles,
    colours: selection.colours.filter((value) => colourOnly(value) !== null),
    painted: colourOnly(selection.painted),
  };
}

export function samePreviewLoad(iframe: HTMLIFrameElement): () => boolean {
  const client = previewEditingClient(iframe);
  return () => clients.get(iframe)?.client === client;
}

const promotedTo = new WeakMap<HTMLIFrameElement, HTMLIFrameElement>();

export function notePreviewPromoted(retired: HTMLIFrameElement, live: HTMLIFrameElement): void {
  promotedTo.set(retired, live);
}

export function shownPreviewFrame(iframe: HTMLIFrameElement): HTMLIFrameElement {
  let shown = iframe;
  for (let next = promotedTo.get(shown); next; next = promotedTo.get(shown)) shown = next;
  return shown;
}

export function retirePreviewEditingClient(iframe: HTMLIFrameElement): void {
  clients.get(iframe)?.retire();
}

export function setFrameLoopStart(iframe: HTMLIFrameElement, seconds: number | null): void {
  if (!previewFrameOpaque(iframe)) {
    try {
      (iframe.contentWindow as IframeWindow | null)?.__hf?.setLoopStart?.(seconds);
    } catch {}
    return;
  }
  const client = previewEditingClient(iframe);
  if (loopStarts.has(client) && loopStarts.get(client) === seconds) return;
  loopStarts.set(client, seconds);
  client.request("set-loop-start", { seconds }).catch(() => {
    if (loopStarts.get(client) === seconds) loopStarts.delete(client);
  });
}

export const AGENT_PROBE_MS = 1_000;

const agents = new WeakMap<EditingPortClient, boolean>();
const pendingProbes = new WeakMap<EditingPortClient, Promise<boolean>>();
const turnsWaiting = new WeakMap<EditingPortClient, Promise<boolean>>();

function agentConnectedInCallOrder(client: EditingPortClient): boolean | Promise<boolean> {
  const pending = pendingProbes.get(client);
  if (pending) return pending;
  const known = agents.get(client);
  if (known !== undefined) return known;
  const probe = probeAgent(client).finally(() => pendingProbes.delete(client));
  pendingProbes.set(client, probe);
  return probe;
}

async function probeAgent(client: EditingPortClient): Promise<boolean> {
  client.ready.then(
    () => agents.set(client, true),
    () => agents.set(client, false),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const probe = new Promise<boolean>(
    (resolve) => (timer = setTimeout(resolve, AGENT_PROBE_MS, false)),
  );
  const connected = await Promise.race([
    client.ready.then(
      () => true,
      () => false,
    ),
    probe,
  ]);
  clearTimeout(timer);
  if (!agents.has(client)) agents.set(client, connected);
  return connected;
}

export const PREVIEW_REJECTED = Symbol("preview-rejected");
export const PREVIEW_STALE = Symbol("preview-stale");

/** previewRequest's reply, keeping an error answer (PREVIEW_REJECTED) apart from no reply (null: no port, timeout). */
export async function previewAnswer<K extends EditingRequestKind>(
  iframe: HTMLIFrameElement,
  kind: K,
  params: EditingParams<K>,
  timeoutMs?: number,
  admit?: () => boolean,
  priority: ReadPriority = "now",
): Promise<EditingResult<K> | typeof PREVIEW_REJECTED | typeof PREVIEW_STALE | null> {
  frameRequestSent(kind);
  const client = previewEditingClient(iframe);
  const connected = agentConnectedInCallOrder(client);
  const earlier = turnsWaiting.get(client);
  if (typeof connected === "boolean" && !earlier)
    return connected ? sendInTurn(client, kind, params, timeoutMs, admit, priority) : null;
  const turn = (earlier ?? Promise.resolve()).then(() => connected);
  turnsWaiting.set(client, turn);
  const ready = await turn;
  if (turnsWaiting.get(client) === turn) turnsWaiting.delete(client);
  return ready ? sendInTurn(client, kind, params, timeoutMs, admit, priority) : null;
}

export type ReadPriority = "now" | "behind-drafts";
const gestureHolds = new Set<() => boolean>();
const heldReads = new Map<EditingPortClient, Array<() => void>>();

export function holdRefreshReadsWhile(held: () => boolean): void {
  gestureHolds.add(held);
}

function gestureHeld(): boolean {
  for (const held of gestureHolds) {
    if (held()) return true;
    gestureHolds.delete(held);
  }
  return false;
}

export function releaseEndedGestureHolds(): void {
  if (gestureHeld()) return;
  for (const client of [...heldReads.keys()]) releaseHeldReads(client);
}

function releaseHeldReads(client: EditingPortClient): void {
  const queue = heldReads.get(client);
  heldReads.delete(client);
  queue?.forEach((send) => send());
}

type Answer<K extends EditingRequestKind> =
  | EditingResult<K>
  | typeof PREVIEW_REJECTED
  | typeof PREVIEW_STALE
  | null;

function sendInTurn<K extends EditingRequestKind>(
  client: EditingPortClient,
  kind: K,
  params: EditingParams<K>,
  timeoutMs: number | undefined,
  admit: (() => boolean) | undefined,
  priority: ReadPriority,
): Answer<K> | Promise<Answer<K>> {
  if (priority === "now" || !gestureHeld()) {
    const sent = sendForAnswer(client, kind, params, timeoutMs, admit);
    if (kind === "draft") releaseHeldReads(client);
    return sent;
  }
  let queue = heldReads.get(client);
  if (!queue) {
    const waiting: Array<() => void> = [];
    heldReads.set(client, (queue = waiting));
    requestAnimationFrame(() => heldReads.get(client) === waiting && releaseHeldReads(client));
  }
  const held = queue;
  return new Promise<Answer<K>>((resolve) =>
    held.push(() => resolve(sendForAnswer(client, kind, params, timeoutMs, admit))),
  );
}

function sendForAnswer<K extends EditingRequestKind>(
  client: EditingPortClient,
  kind: K,
  params: EditingParams<K>,
  timeoutMs?: number,
  admit?: () => boolean,
): typeof PREVIEW_STALE | Promise<EditingResult<K> | typeof PREVIEW_REJECTED | null> {
  if (admit && !admit()) return PREVIEW_STALE;
  return client.request(kind, params, { timeoutMs }).catch((err: unknown) => {
    const noReply =
      err instanceof EditingPortError && (err.code === "timeout" || err.code === "disposed");
    return noReply ? null : PREVIEW_REJECTED;
  });
}

export async function previewRequest<K extends EditingRequestKind>(
  iframe: HTMLIFrameElement,
  kind: K,
  params: EditingParams<K>,
  timeoutMs?: number,
  priority: ReadPriority = "now",
): Promise<EditingResult<K> | null> {
  const answer = await previewAnswer(iframe, kind, params, timeoutMs, undefined, priority);
  return answer === PREVIEW_REJECTED || answer === PREVIEW_STALE ? null : answer;
}

export async function previewSeekPainted(iframe: HTMLIFrameElement, timeoutMs?: number) {
  await previewRequest(iframe, "wait-for-seek", {}, timeoutMs);
}

/** The reply is frame data, so its shape is checked. */
export async function previewClipManifest(iframe: HTMLIFrameElement): Promise<ClipManifest | null> {
  const snapshot = await previewRequest(iframe, "runtime-snapshot", {});
  const manifest: unknown = snapshot?.clipManifest;
  if (typeof manifest !== "object" || manifest === null) return null;
  const { clips, durationInFrames, scenes } = manifest as Record<string, unknown>;
  const wellFormed = wellFormedClips(clips);
  if (!wellFormed || typeof durationInFrames !== "number") return null;
  if (!Number.isFinite(durationInFrames)) return null;
  const listedScenes = (isMessageList(scenes) ? scenes : []) as ClipManifest["scenes"];
  return { ...(manifest as ClipManifest), clips: wellFormed, scenes: listedScenes };
}

export async function previewClipParents(iframe: HTMLIFrameElement): Promise<Map<string, string>> {
  const snapshot = await previewRequest(iframe, "runtime-snapshot", {});
  const pairs: unknown = snapshot?.clipParents;
  const parents = new Map<string, string>();
  if (!isMessageList(pairs, MAX_FRAME_CLIPS)) return parents;
  for (const pair of pairs) {
    if (Array.isArray(pair) && typeof pair[0] === "string" && typeof pair[1] === "string")
      parents.set(pair[0], pair[1]);
  }
  return parents;
}

export async function previewConsoleErrors(
  iframe: HTMLIFrameElement,
  from: number,
  priority: ReadPriority = "now",
): Promise<{ errors: string[]; truncated: boolean } | null> {
  const reply = await previewRequest(iframe, "console-errors", { from }, undefined, priority);
  const errors: unknown = reply?.errors;
  if (!isMessageList(errors, MAX_QUERY_MATCHES) || typeof reply?.truncated !== "boolean")
    return null;
  if (!errors.every((error): error is string => typeof error === "string")) return null;
  return { errors, truncated: reply.truncated };
}

/** The runtime's computed `properties` for the element `target` names; null when it has none. */
export async function previewComputedStyles(
  iframe: HTMLIFrameElement,
  target: string | { handle: string },
  properties: string[],
): Promise<Record<string, string> | null> {
  const element = typeof target === "string" ? { selector: target } : { handle: target.handle };
  const reply = await previewRequest(iframe, "computed-styles", { ...element, properties });
  return readStyles(reply?.styles, properties);
}

export async function previewAuthoredStyles(
  iframe: HTMLIFrameElement,
  handle: string,
  properties: string[],
): Promise<Record<string, string> | null> {
  const reply = await previewRequest(iframe, "authored-styles", { handle, properties });
  return readStyles(reply?.styles, properties);
}

function readStyles(styles: unknown, properties: string[]): Record<string, string> | null {
  if (typeof styles !== "object" || styles === null) return null;
  const read: Record<string, string> = {};
  for (const name of properties) {
    const value: unknown = Object.getOwnPropertyDescriptor(styles, name)?.value;
    if (typeof value === "string" && value) read[name] = value;
  }
  return read;
}

export async function previewComputedStylesOfEvery(
  iframe: HTMLIFrameElement,
  selector: string,
  properties: string[],
): Promise<{ matches: Array<Record<string, string> | null>; truncated: boolean } | null> {
  const reply = await previewRequest(iframe, "computed-styles", {
    selector,
    every: true,
    properties,
  });
  const matches: unknown = reply?.matches;
  if (!isMessageList(matches, MAX_QUERY_MATCHES) || typeof reply?.truncated !== "boolean")
    return null;
  return {
    matches: matches.map((entry: unknown) => readStyles(entry, properties)),
    truncated: reply.truncated,
  };
}

type FontFaces = { families: string[]; ownFaces: Array<{ family: string; src: string }> };

export async function previewFontFaces(iframe: HTMLIFrameElement): Promise<FontFaces | null> {
  const reply = await previewRequest(iframe, "font-faces", {});
  const { families, ownFaces } = reply ?? {};
  const isText = (value: unknown): value is string => typeof value === "string";
  const isFace = (face: unknown): face is FontFaces["ownFaces"][number] =>
    typeof face === "object" &&
    face !== null &&
    isText((face as { family?: unknown }).family) &&
    isText((face as { src?: unknown }).src);
  if (!isMessageList(families, MAX_FONT_FACES) || !families.every(isText)) return null;
  if (!isMessageList(ownFaces, MAX_FONT_FACES) || !ownFaces.every(isFace)) return null;
  return { families, ownFaces: ownFaces.map(({ family, src }) => ({ family, src })) };
}

export async function previewAssetsUnloaded(iframe: HTMLIFrameElement): Promise<boolean | null> {
  const reply = await previewRequest(iframe, "assets-unloaded", {});
  return typeof reply?.unloaded === "boolean" ? reply.unloaded : null;
}

async function documentMarkup(iframe: HTMLIFrameElement) {
  const reply = await previewRequest(iframe, "document-markup", {});
  if (typeof reply?.html !== "string" || typeof reply.baseURI !== "string") return null;
  return { html: reply.html, baseURI: reply.baseURI };
}

export async function previewDocumentMarkup(iframe: HTMLIFrameElement): Promise<string | null> {
  return (await documentMarkup(iframe))?.html ?? null;
}

export async function previewDocumentCopy(iframe: HTMLIFrameElement): Promise<Document | null> {
  const markup = await documentMarkup(iframe);
  if (!markup) return null;
  const doc = new DOMParser().parseFromString(markup.html, "text/html");
  const base = doc.createElement("base");
  base.setAttribute("href", markup.baseURI);
  doc.head.prepend(base);
  return doc;
}
