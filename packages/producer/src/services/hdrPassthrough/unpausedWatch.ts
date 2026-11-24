/**
 * HDR passthrough: the capture page's watch, which never pauses the page.
 *
 * The analysis page is watched with the debugger (`registrationWatch.ts`):
 * it pauses at the first statement of each script while the page loads and
 * at each registration call. A page can time those pauses on a clock the
 * virtual-time shim does not replace (`Event#timeStamp`, a
 * `performance.mark`) and paint differently when it was paused; the layered
 * session, which is never paused, then paints the other way. It can time
 * its own compiles the same way: with the debugger enabled each one is
 * reported to DevTools, which made a loop of tiny `eval`s ten times slower
 * or more against `JSON.parse` than in the layered session. So the page
 * capture screenshots loads with no debugger at all:
 *
 * - the debugger is enabled only once the page is ready, after V8's call
 *   counts start (`pageCodeWatch.ts`), so any page code that could time it
 *   is counted and declines; its breakpoints are deactivated as soon as it
 *   is (`Debugger.setBreakpointsActive`), so a page `debugger` statement
 *   runs on as in the layered session; a pause that happens anyway is
 *   resumed and declines;
 * - the main world's builtins are captured before any page script runs by
 *   a script DevTools adds to the new document (`CAPTURE_SOURCE`, the
 *   analysis page's capture, under a random name in the global lexical
 *   scope, which no page script can enumerate), read back over DevTools once
 *   the page is ready;
 * - what the page registered while it loaded is counted from outside once
 *   it is ready and compared with the analysis page's count
 *   (`loadCensus.ts`): the analysis page's watch saw every registration
 *   there, and a page that registers anything else on the capture page loads
 *   differently there and declines.
 *
 * The capture runs once, before any page script, and leaves nothing a page
 * script can reach: the name is 128 random bits and the capture object is
 * referenced from nowhere else.
 */

import { randomBytes } from "node:crypto";
import type { getCdpSession } from "@hyperframes/engine";
import { CAPTURE_OBJECT_GROUP, CAPTURE_SOURCE } from "./mainWorld.js";
import type { RegistrationWatch } from "./registrationWatch.js";

type Client = Awaited<ReturnType<typeof getCdpSession>>;

/** The new-document script that captures the builtins under `name`. */
function captureScript(name: string): string {
  return `const ${name} = ${CAPTURE_SOURCE};`;
}

/**
 * Arm the capture page's watch on a page that has not navigated yet. The
 * debugger stays off while the page loads; `ready()` expects it enabled
 * (`ScriptOriginRecord.observe`) on `client`, and deactivates its
 * breakpoints first.
 */
export async function armUnpausedWatch(client: Client): Promise<RegistrationWatch> {
  const name = `__hfPassthroughCapture${randomBytes(16).toString("hex")}`;
  let failure: string | undefined;
  let identifier: string | undefined;
  let capture: string | undefined;
  const fail = (detail: string) => {
    failure ??= detail;
  };
  const removeScript = async () => {
    if (identifier === undefined) return;
    const id = identifier;
    identifier = undefined;
    await client
      .send("Page.removeScriptToEvaluateOnNewDocument", { identifier: id })
      .catch(() => undefined);
  };

  let pauses = 0;
  const onPaused = () => {
    pauses++;
    fail("the capture page was paused");
    void client.send("Debugger.resume").catch(() => undefined);
  };
  try {
    client.on("Debugger.paused", onPaused);
    await client.send("Page.enable");
    ({ identifier } = (await client.send("Page.addScriptToEvaluateOnNewDocument", {
      source: captureScript(name),
    })) as { identifier: string });
  } catch (error) {
    fail(
      `capture page watch unavailable (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  return {
    async ready() {
      try {
        await client.send("Debugger.setBreakpointsActive", { active: false });
        await client.send("Debugger.setSkipAllPauses", { skip: true });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        fail(`capture page breakpoints still active (${detail})`);
      }
      if (identifier === undefined) {
        if (capture === undefined) fail("the document's builtins were never captured");
        return;
      }
      await removeScript();
      try {
        const { result, exceptionDetails } = (await client.send("Runtime.evaluate", {
          expression: name,
          objectGroup: CAPTURE_OBJECT_GROUP,
        })) as { result: { objectId?: string }; exceptionDetails?: unknown };
        if (exceptionDetails || !result.objectId) throw new Error("no capture in the document");
        capture = result.objectId;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        fail(`the document's builtins were never captured (${detail})`);
      }
    },
    findings: () => null,
    captureId: () => capture,
    stats: () => ({ pauses, pausedMs: 0 }),
    failure: () => failure,
    async dispose() {
      client.off("Debugger.paused", onPaused);
      await removeScript();
      await client
        .send("Runtime.releaseObjectGroup", { objectGroup: CAPTURE_OBJECT_GROUP })
        .catch(() => undefined);
    },
  };
}
