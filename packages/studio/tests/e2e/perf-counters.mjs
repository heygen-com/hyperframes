/**
 * Deterministic work counts for a Studio browser journey: how much work ran,
 * not how long it took, so the numbers do not move with runner load.
 * Compare them against perf-ceilings.json with perf-ratchet.mjs.
 */

/** Runs in every frame before any page script; child frames add into the top frame's tally. */
function installInPage(options) {
  let counts;
  try {
    counts = window.top.__hfWorkCounts ??= {};
  } catch {
    counts = window.__hfWorkCounts ??= {};
  }
  const add = (key) => {
    counts[key] = (counts[key] ?? 0) + 1;
  };
  if (window === window.top && !window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
    // React calls this hook on every commit, production builds included.
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      renderers: new Map(),
      inject: () => 1,
      onCommitFiberRoot: () => add("reactCommits"),
      onCommitFiberUnmount() {},
      onPostCommitFiberRoot() {},
      checkDCE() {},
    };
  }
  if (!options.pageActivity) return;
  new MutationObserver((records) => {
    counts.domMutations = (counts.domMutations ?? 0) + records.length;
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  const countCallbacks = (name, key) => {
    const native = window[name];
    window[name] = function (callback, ...rest) {
      if (typeof callback !== "function") return native.call(this, callback, ...rest);
      return native.call(
        this,
        function (...args) {
          add(key);
          return callback.apply(this, args);
        },
        ...rest,
      );
    };
  };
  countCallbacks("setTimeout", "timerCallbacks");
  countCallbacks("setInterval", "timerCallbacks");
  countCallbacks("requestAnimationFrame", "rafCallbacks");
}

/**
 * Start counting on `page` before it navigates. `pageActivity` adds DOM
 * mutations, timer and animation-frame callbacks; leave it off where the
 * observer itself would weigh on a timed measurement.
 */
export async function startWorkCounters(browser, page, { pageActivity = true } = {}) {
  await page.evaluateOnNewDocument(installInPage, { pageActivity });
  const client = await page.createCDPSession();
  await client.send("Performance.enable");
  const tally = { requests: {}, frameNavigations: 0, targetsCreated: 0 };
  page.on("request", (request) => {
    const kind = request.url().includes("/thumbnail/") ? "thumbnail" : request.resourceType();
    tally.requests[kind] = (tally.requests[kind] ?? 0) + 1;
  });
  page.on("framenavigated", () => {
    tally.frameNavigations += 1;
  });
  browser.on("targetcreated", () => {
    tally.targetsCreated += 1;
  });

  return {
    client,
    /** A flat snapshot of every counter so far; subtract two snapshots for a window. */
    async read() {
      const { metrics } = await client.send("Performance.getMetrics");
      const metric = (name) => metrics.find((entry) => entry.name === name)?.value ?? 0;
      const inPage = await page.evaluate(() => ({ ...window.__hfWorkCounts }));
      const snapshot = {
        reactCommits: 0,
        ...inPage,
        styleRecalcs: metric("RecalcStyleCount"),
        layouts: metric("LayoutCount"),
        frameNavigations: tally.frameNavigations,
        targetsCreated: tally.targetsCreated,
      };
      for (const [kind, count] of Object.entries(tally.requests)) {
        snapshot[`requests.${kind}`] = count;
      }
      return snapshot;
    },
  };
}

/** `after - before` per counter; a counter absent from `before` started at zero. */
export function diffCounts(after, before) {
  return Object.fromEntries(
    Object.entries(after).map(([key, value]) => [key, value - (before[key] ?? 0)]),
  );
}
