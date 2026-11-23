/**
 * HDR passthrough: probes that run where the page cannot reach them.
 *
 * A DevTools isolated world shares the page's DOM, CSSOM, layout and paint
 * state but has its own JavaScript globals: page script can neither see it
 * nor replace the builtins code there calls (`JSON.stringify`,
 * `Element.prototype.matches`, `TextEncoder`), and expandos the page puts on
 * elements are not visible in it. The overlay fingerprint and the other DOM
 * probes run there, and return plain data; anything to hash is hashed in
 * Node.
 *
 * Scripts compiled in an isolated world are the renderer's
 * (`scriptOrigins.ts`), and nothing run there is page code.
 */

import { type CaptureSession, getCdpSession } from "@hyperframes/engine";

type Page = CaptureSession["page"];
type Client = Awaited<ReturnType<typeof getCdpSession>>;

const WORLD_NAME = "hf-hdr-passthrough";

/** Object group the isolated world's handles live in. */
const ISOLATED_OBJECT_GROUP = "hf-hdr-passthrough-isolated";

interface World {
  client: Client;
  contextId: number;
  /** Functions compiled once in the world, by source text: their handles. */
  functions: Map<string, Promise<string>>;
}

/** Object group of the compiled functions, kept for the world's lifetime. */
const FUNCTIONS_OBJECT_GROUP = "hf-hdr-passthrough-isolated-functions";

/** Calls `this` (a function compiled in the world) with the call's arguments. */
const APPLY_DECLARATION = "function () { return Reflect.apply(this, undefined, arguments); }";

const worlds = new WeakMap<Page, Promise<World>>();

/**
 * The tsx/esbuild `__name` helper some transpiled functions call; the main
 * world gets it from the engine, an isolated world needs its own.
 */
const NAME_HELPER = "globalThis.__name = function (fn) { return fn; };";

async function createWorld(page: Page): Promise<World> {
  const client = await getCdpSession(page);
  const { frameTree } = (await client.send("Page.getFrameTree")) as {
    frameTree: { frame: { id: string } };
  };
  const { executionContextId } = (await client.send("Page.createIsolatedWorld", {
    frameId: frameTree.frame.id,
    worldName: WORLD_NAME,
    grantUniveralAccess: false,
  })) as { executionContextId: number };
  await client.send("Runtime.evaluate", { expression: NAME_HELPER, contextId: executionContextId });
  return { client, contextId: executionContextId, functions: new Map() };
}

/** A handle on `declaration` compiled in the world, compiled on first use. */
function compiled(world: World, declaration: string): Promise<string> {
  let handle = world.functions.get(declaration);
  if (!handle) {
    handle = (async () => {
      const { result, exceptionDetails } = (await world.client.send("Runtime.evaluate", {
        expression: `(${declaration})`,
        contextId: world.contextId,
        objectGroup: FUNCTIONS_OBJECT_GROUP,
      })) as CallResult;
      if (exceptionDetails || !result.objectId) throw new Error("isolated probe did not compile");
      return result.objectId;
    })();
    handle.catch(() => world.functions.delete(declaration));
    world.functions.set(declaration, handle);
  }
  return handle;
}

/** The overlay page's isolated world, created once per document. */
async function isolatedWorld(page: Page): Promise<World> {
  let world = worlds.get(page);
  if (!world) {
    world = createWorld(page);
    worlds.set(page, world);
    world.catch(() => worlds.delete(page));
  }
  return world;
}

/** A CDP call argument: a JSON value, or a handle in the isolated world. */
export type IsolatedArg = { value: unknown } | { objectId: string };

interface CallResult {
  result: { value?: unknown; objectId?: string; type?: string };
  exceptionDetails?: { text?: string; exception?: { description?: string } };
}

// fallow-ignore-next-line complexity
async function call(
  page: Page,
  declaration: string,
  args: readonly IsolatedArg[],
  returnByValue: boolean,
): Promise<CallResult["result"]> {
  for (let attempt = 0; ; attempt++) {
    const { client, contextId } = await isolatedWorld(page);
    try {
      const { result, exceptionDetails } = (await client.send("Runtime.callFunctionOn", {
        functionDeclaration: declaration,
        executionContextId: contextId,
        arguments: [...args],
        returnByValue,
        awaitPromise: true,
        objectGroup: ISOLATED_OBJECT_GROUP,
      })) as CallResult;
      if (exceptionDetails) {
        const detail = exceptionDetails.exception?.description ?? exceptionDetails.text;
        throw new Error(`isolated probe threw (${detail ?? "unknown"})`);
      }
      return result;
    } catch (error) {
      // The world dies with its document; one retry in a fresh one.
      const message = error instanceof Error ? error.message : String(error);
      if (attempt > 0 || !/context/i.test(message)) throw error;
      worlds.delete(page);
    }
  }
}

/** Calls `fn` in the isolated world with JSON arguments and returns its JSON result. */
export async function evaluateIsolated<Args extends unknown[], R>(
  page: Page,
  fn: (...args: Args) => R | Promise<R>,
  ...args: Args
): Promise<R> {
  const result = await call(
    page,
    fn.toString(),
    args.map((value) => ({ value })),
    true,
  );
  return result.value as R;
}

/**
 * Calls `fn` in the isolated world with handle or JSON arguments and returns
 * its JSON result. `fn` is compiled there once and called by handle, which a
 * probe that runs on every frame (the fingerprint) needs: compiling its text
 * on every call costs more than running it.
 */
export async function callIsolated<R>(
  page: Page,
  fn: (...args: never[]) => R | Promise<R>,
  args: readonly IsolatedArg[],
): Promise<R> {
  for (let attempt = 0; ; attempt++) {
    const world = await isolatedWorld(page);
    try {
      const objectId = await compiled(world, fn.toString());
      const { result, exceptionDetails } = (await world.client.send("Runtime.callFunctionOn", {
        functionDeclaration: APPLY_DECLARATION,
        objectId,
        arguments: [...args],
        returnByValue: true,
        awaitPromise: true,
      })) as CallResult;
      if (exceptionDetails) {
        const detail = exceptionDetails.exception?.description ?? exceptionDetails.text;
        throw new Error(`isolated probe threw (${detail ?? "unknown"})`);
      }
      return result.value as R;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt > 0 || !/context|object/i.test(message)) throw error;
      worlds.delete(page);
    }
  }
}

/** Calls `fn` in the isolated world and keeps its result as a handle there. */
export async function handleIsolated(
  page: Page,
  fn: (...args: never[]) => unknown,
  args: readonly IsolatedArg[],
): Promise<string> {
  const result = await call(page, fn.toString(), args, false);
  if (!result.objectId) throw new Error("isolated probe returned no object");
  return result.objectId;
}

/**
 * The isolated world's handles for main-world element handles, through
 * their DOM node: the same elements, as code in the isolated world sees
 * them. A handle that is not a node resolves to `undefined`.
 */
export async function adoptElements(
  page: Page,
  mainWorldObjectIds: readonly string[],
): Promise<Array<string | undefined>> {
  const { client, contextId } = await isolatedWorld(page);
  const out: Array<string | undefined> = [];
  for (const objectId of mainWorldObjectIds) {
    try {
      const { node } = (await client.send("DOM.describeNode", { objectId })) as {
        node: { backendNodeId: number };
      };
      const { object } = (await client.send("DOM.resolveNode", {
        backendNodeId: node.backendNodeId,
        executionContextId: contextId,
        objectGroup: ISOLATED_OBJECT_GROUP,
      })) as { object: { objectId?: string } };
      out.push(object.objectId);
    } catch {
      out.push(undefined);
    }
  }
  return out;
}

/** Releases the isolated world's handles; never throws. */
export async function releaseIsolated(page: Page): Promise<void> {
  const world = worlds.get(page);
  if (!world) return;
  try {
    const { client } = await world;
    await client.send("Runtime.releaseObjectGroup", { objectGroup: ISOLATED_OBJECT_GROUP });
    await client.send("Runtime.releaseObjectGroup", { objectGroup: FUNCTIONS_OBJECT_GROUP });
  } catch {
    // The page is gone.
  }
}
