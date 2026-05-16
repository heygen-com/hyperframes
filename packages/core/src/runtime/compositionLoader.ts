import { scopeCssToComposition, wrapScopedCompositionScript } from "../compiler/compositionScoping";
import { readDeclaredDefaults } from "./getVariables";

type LoadExternalCompositionsParams = {
  injectedStyles: HTMLStyleElement[];
  injectedScripts: HTMLScriptElement[];
  parseDimensionPx: (value: string | null) => string | null;
  onDiagnostic?: (payload: {
    code: string;
    details: Record<string, string | number | boolean | null | string[]>;
  }) => void;
};

type PendingScript =
  | {
      kind: "inline";
      content: string;
      type: string;
      scopeCompositionId: string | null;
    }
  | {
      kind: "external";
      src: string;
      type: string;
    };

const EXTERNAL_SCRIPT_LOAD_TIMEOUT_MS = 8000;
const BARE_RELATIVE_PATH_RE = /^(?![a-zA-Z][a-zA-Z\d+\-.]*:)(?!\/\/)(?!\/)(?!\.\.?\/).+/;

function uniqueCompositionId(baseId: string, index: number): string {
  return `${baseId}__hf${index}`;
}

const waitForExternalScriptLoad = (
  scriptEl: HTMLScriptElement,
): Promise<{ status: "load" | "error" | "timeout"; elapsedMs: number }> =>
  new Promise((resolve) => {
    let settled = false;
    const startedAt = Date.now();
    let timeoutId: number | null = null;
    const settle = (status: "load" | "error" | "timeout") => {
      if (settled) return;
      settled = true;
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
      resolve({
        status,
        elapsedMs: Math.max(0, Date.now() - startedAt),
      });
    };
    scriptEl.addEventListener("load", () => settle("load"), { once: true });
    scriptEl.addEventListener("error", () => settle("error"), { once: true });
    timeoutId = window.setTimeout(() => settle("timeout"), EXTERNAL_SCRIPT_LOAD_TIMEOUT_MS);
  });

function resetCompositionHost(host: Element) {
  while (host.firstChild) {
    host.removeChild(host.firstChild);
  }
  host.textContent = "";
}

const FLATTENED_INNER_ROOT_STRIP_ATTRS = [
  "data-composition-id",
  "data-composition-file",
  "data-start",
  "data-duration",
  "data-end",
  "data-track-index",
  "data-track",
  "data-composition-src",
  "data-hf-authored-duration",
  "data-hf-authored-end",
];

function prepareFlattenedInnerRoot(innerRoot: HTMLElement): HTMLElement {
  const prepared = document.importNode(innerRoot, true) as HTMLElement;
  const authoredRootId = prepared.getAttribute("id")?.trim();
  for (const attrName of FLATTENED_INNER_ROOT_STRIP_ATTRS) {
    prepared.removeAttribute(attrName);
  }
  if (authoredRootId) {
    prepared.removeAttribute("id");
    prepared.setAttribute("data-hf-authored-id", authoredRootId);
  }
  prepared.setAttribute("data-hf-inner-root", "true");
  return prepared;
}

function resolveScriptSourceUrl(scriptSrc: string, compositionUrl: URL | null): string {
  const trimmedSrc = scriptSrc.trim();
  if (!trimmedSrc) return scriptSrc;
  try {
    if (BARE_RELATIVE_PATH_RE.test(trimmedSrc)) {
      // Composition payloads may use root-relative semantics without a leading slash.
      return new URL(trimmedSrc, document.baseURI).toString();
    }
    if (compositionUrl) {
      return new URL(trimmedSrc, compositionUrl).toString();
    }
    return new URL(trimmedSrc, document.baseURI).toString();
  } catch {
    return scriptSrc;
  }
}

function parseHostVariableValues(host: Element): Record<string, unknown> {
  const raw = host.getAttribute("data-variable-values");
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}

type HostCompositionIdentity = {
  authoredCompositionId: string | null;
  runtimeCompositionId: string | null;
};

function getHostCompositionIdentity(host: Element): HostCompositionIdentity {
  const currentCompositionId = (host.getAttribute("data-composition-id") || "").trim() || null;
  const authoredCompositionId =
    (host.getAttribute("data-hf-original-composition-id") || currentCompositionId || "").trim() ||
    null;
  return {
    authoredCompositionId,
    runtimeCompositionId: currentCompositionId,
  };
}

function countAuthoredCompositionIds(hosts: Element[]): Map<string, number> {
  const hostCountsByCompositionId = new Map<string, number>();
  for (const host of hosts) {
    const compId = getHostCompositionIdentity(host).authoredCompositionId || "";
    if (!compId) continue;
    hostCountsByCompositionId.set(compId, (hostCountsByCompositionId.get(compId) || 0) + 1);
  }
  return hostCountsByCompositionId;
}

function hasMatchingInlineTemplate(host: Element): boolean {
  const authoredCompositionId = getHostCompositionIdentity(host).authoredCompositionId;
  if (!authoredCompositionId) return false;
  return !!document.querySelector(`template#${CSS.escape(authoredCompositionId)}-template`);
}

function isMountedInlineCompositionHost(host: Element): boolean {
  return !!host.querySelector('[data-hf-inner-root="true"]');
}

function shouldAssignRuntimeCompositionId(host: Element): boolean {
  if (host.hasAttribute("data-composition-src")) return true;
  if (!hasMatchingInlineTemplate(host)) return false;
  if (host.children.length === 0) return true;
  if (host.hasAttribute("data-hf-original-composition-id")) return true;
  return isMountedInlineCompositionHost(host);
}

function getTrackedCompositionHosts(): Element[] {
  const hosts = Array.from(
    document.querySelectorAll<Element>("[data-composition-src], [data-composition-id]"),
  );
  return hosts.filter((host) => {
    if (host.hasAttribute("data-composition-src")) return true;
    return hasMatchingInlineTemplate(host);
  });
}

function cleanupDetachedScopedVariables() {
  const byComp = window.__hfVariablesByComp;
  if (!byComp) return;

  const activeRuntimeCompositionIds = new Set(
    getTrackedCompositionHosts()
      .map((host) => getHostCompositionIdentity(host).runtimeCompositionId)
      .filter((compositionId): compositionId is string => !!compositionId),
  );

  for (const runtimeCompositionId of Object.keys(byComp)) {
    if (!activeRuntimeCompositionIds.has(runtimeCompositionId)) {
      delete byComp[runtimeCompositionId];
    }
  }
}

function assignRuntimeCompositionIds(
  hosts: Element[],
  hostCountsByCompositionId: Map<string, number> = countAuthoredCompositionIds(hosts),
): Map<Element, HostCompositionIdentity> {
  const hostInstanceByCompositionId = new Map<string, number>();
  const hostIdentityByElement = new Map<Element, HostCompositionIdentity>();

  for (const host of hosts) {
    const { authoredCompositionId, runtimeCompositionId: previousRuntimeCompositionId } =
      getHostCompositionIdentity(host);
    const shouldAssign = shouldAssignRuntimeCompositionId(host);
    if (!authoredCompositionId) {
      hostIdentityByElement.set(host, {
        authoredCompositionId: null,
        runtimeCompositionId: previousRuntimeCompositionId,
      });
      continue;
    }

    const duplicateInstance = (hostCountsByCompositionId.get(authoredCompositionId) || 0) > 1;
    let runtimeCompositionId = previousRuntimeCompositionId || authoredCompositionId;
    if (shouldAssign) {
      const instanceIndex = duplicateInstance
        ? (hostInstanceByCompositionId.get(authoredCompositionId) || 0) + 1
        : 0;
      if (duplicateInstance) {
        hostInstanceByCompositionId.set(authoredCompositionId, instanceIndex);
      }

      runtimeCompositionId = duplicateInstance
        ? uniqueCompositionId(authoredCompositionId, instanceIndex)
        : authoredCompositionId;

      if (duplicateInstance) {
        host.setAttribute("data-hf-original-composition-id", authoredCompositionId);
      } else {
        host.removeAttribute("data-hf-original-composition-id");
      }
      host.setAttribute("data-composition-id", runtimeCompositionId);
      if (
        previousRuntimeCompositionId &&
        previousRuntimeCompositionId !== runtimeCompositionId &&
        window.__hfVariablesByComp
      ) {
        delete window.__hfVariablesByComp[previousRuntimeCompositionId];
      }
    }

    hostIdentityByElement.set(host, {
      authoredCompositionId,
      runtimeCompositionId,
    });
  }

  return hostIdentityByElement;
}

async function mountCompositionContent(params: {
  host: Element;
  authoredCompositionId: string | null;
  runtimeCompositionId: string | null;
  hostCompositionSrc: string;
  sourceNode: ParentNode;
  hasTemplate: boolean;
  fallbackBodyInnerHtml: string;
  compositionUrl: URL | null;
  injectedStyles: HTMLStyleElement[];
  injectedScripts: HTMLScriptElement[];
  parseDimensionPx: (value: string | null) => string | null;
  /** Extra <style> elements from the parsed document <head> (non-template sub-compositions). */
  headStyles?: HTMLStyleElement[];
  /** Extra <script> elements from the parsed document <head> (non-template sub-compositions). */
  headScripts?: HTMLScriptElement[];
  /**
   * Defaults extracted from the sub-composition's own
   * `<html data-composition-variables="...">` attribute. Layered under the
   * host element's `data-variable-values` to produce the per-instance
   * variables visible inside the sub-comp's scoped `getVariables()`.
   * Populated only by `loadExternalCompositions`; inline templates have no
   * separate document root so no declared defaults are passed.
   */
  declaredVariableDefaults?: Record<string, unknown>;
  onDiagnostic?: (payload: {
    code: string;
    details: Record<string, string | number | boolean | null | string[]>;
  }) => void;
}): Promise<void> {
  let innerRoot: Element | null = null;
  if (params.authoredCompositionId) {
    const candidateRoots = Array.from(
      params.sourceNode.querySelectorAll<Element>("[data-composition-id]"),
    );
    innerRoot =
      candidateRoots.find(
        (candidate) =>
          candidate.getAttribute("data-composition-id") === params.authoredCompositionId,
      ) ?? null;
  }
  const contentNode = innerRoot ?? params.sourceNode;
  const authoredScopeCompositionId =
    innerRoot?.getAttribute("data-composition-id")?.trim() || params.authoredCompositionId || null;
  const runtimeScopeCompositionId =
    params.runtimeCompositionId || authoredScopeCompositionId || null;
  const authoredRootId = innerRoot?.getAttribute("id")?.trim() || null;
  const runtimeScopeSelector = runtimeScopeCompositionId
    ? `[data-composition-id="${CSS.escape(runtimeScopeCompositionId)}"]`
    : undefined;

  // Inject <head> styles from non-template sub-compositions first (they define
  // element styles like backgrounds and positioning that the composition needs).
  if (params.headStyles) {
    for (const style of params.headStyles) {
      const clonedStyle = style.cloneNode(true);
      if (!(clonedStyle instanceof HTMLStyleElement)) continue;
      if (authoredScopeCompositionId) {
        clonedStyle.textContent = scopeCssToComposition(
          clonedStyle.textContent || "",
          authoredScopeCompositionId,
          runtimeScopeSelector,
          authoredRootId,
        );
      }
      document.head.appendChild(clonedStyle);
      params.injectedStyles.push(clonedStyle);
    }
  }

  const styles = Array.from(contentNode.querySelectorAll<HTMLStyleElement>("style"));
  for (const style of styles) {
    const clonedStyle = style.cloneNode(true);
    if (!(clonedStyle instanceof HTMLStyleElement)) continue;
    if (authoredScopeCompositionId) {
      clonedStyle.textContent = scopeCssToComposition(
        clonedStyle.textContent || "",
        authoredScopeCompositionId,
        runtimeScopeSelector,
        authoredRootId,
      );
    }
    document.head.appendChild(clonedStyle);
    params.injectedStyles.push(clonedStyle);
  }

  // Collect head scripts first (e.g. GSAP CDN loaded in <head> of non-template sub-comps),
  // then content scripts. Head scripts must execute before content scripts.
  const headScriptPayloads: PendingScript[] = [];
  if (params.headScripts) {
    for (const script of params.headScripts) {
      const scriptType = script.getAttribute("type")?.trim() ?? "";
      const scriptSrc = script.getAttribute("src")?.trim() ?? "";
      if (scriptSrc) {
        const resolvedSrc = resolveScriptSourceUrl(scriptSrc, params.compositionUrl);
        headScriptPayloads.push({ kind: "external", src: resolvedSrc, type: scriptType });
      } else {
        const scriptText = script.textContent?.trim() ?? "";
        if (scriptText) {
          headScriptPayloads.push({
            kind: "inline",
            content: scriptText,
            type: scriptType,
            scopeCompositionId: authoredScopeCompositionId,
          });
        }
      }
    }
  }

  const scripts = Array.from(contentNode.querySelectorAll<HTMLScriptElement>("script"));
  const scriptPayloads: PendingScript[] = [...headScriptPayloads];
  for (const script of scripts) {
    const scriptType = script.getAttribute("type")?.trim() ?? "";
    const scriptSrc = script.getAttribute("src")?.trim() ?? "";
    if (scriptSrc) {
      const resolvedSrc = resolveScriptSourceUrl(scriptSrc, params.compositionUrl);
      scriptPayloads.push({
        kind: "external",
        src: resolvedSrc,
        type: scriptType,
      });
    } else {
      const scriptText = script.textContent?.trim() ?? "";
      if (scriptText) {
        scriptPayloads.push({
          kind: "inline",
          content: scriptText,
          type: scriptType,
          scopeCompositionId: authoredScopeCompositionId,
        });
      }
    }
    script.parentNode?.removeChild(script);
  }
  const remainingStyles = Array.from(contentNode.querySelectorAll<HTMLStyleElement>("style"));
  for (const style of remainingStyles) {
    style.parentNode?.removeChild(style);
  }

  if (innerRoot) {
    const widthRaw = innerRoot.getAttribute("data-width");
    const heightRaw = innerRoot.getAttribute("data-height");
    const widthPx = params.parseDimensionPx(widthRaw);
    const heightPx = params.parseDimensionPx(heightRaw);
    if (widthRaw) params.host.setAttribute("data-width", widthRaw);
    if (heightRaw) params.host.setAttribute("data-height", heightRaw);
    if (widthPx && params.host instanceof HTMLElement) params.host.style.width = widthPx;
    if (heightPx && params.host instanceof HTMLElement) params.host.style.height = heightPx;
    params.host.appendChild(prepareFlattenedInnerRoot(innerRoot));
  } else if (params.hasTemplate) {
    params.host.appendChild(document.importNode(contentNode, true));
  } else {
    params.host.innerHTML = params.fallbackBodyInnerHtml;
  }

  // Stash the per-instance variables BEFORE running scripts. The scoped
  // `getVariables()` injected by `compositionScoping.ts` reads from
  // `window.__hfVariablesByComp[compId]`, so this table must be populated
  // before the wrapped IIFE evaluates.
  if (runtimeScopeCompositionId) {
    const merged = {
      ...(params.declaredVariableDefaults ?? {}),
      ...parseHostVariableValues(params.host),
    };
    if (Object.keys(merged).length > 0) {
      if (!window.__hfVariablesByComp) window.__hfVariablesByComp = {};
      window.__hfVariablesByComp[runtimeScopeCompositionId] = merged;
    } else if (window.__hfVariablesByComp) {
      delete window.__hfVariablesByComp[runtimeScopeCompositionId];
    }
  }

  for (const scriptPayload of scriptPayloads) {
    const injectedScript = document.createElement("script");
    if (scriptPayload.type) {
      injectedScript.type = scriptPayload.type;
    }
    // Preserve deterministic script execution order across injected composition scripts.
    injectedScript.async = false;
    if (scriptPayload.kind === "external") {
      injectedScript.src = scriptPayload.src;
    } else if (scriptPayload.type.toLowerCase() === "module") {
      injectedScript.textContent = scriptPayload.content;
    } else if (scriptPayload.scopeCompositionId) {
      injectedScript.textContent = wrapScopedCompositionScript(
        scriptPayload.content,
        scriptPayload.scopeCompositionId,
        "[HyperFrames] composition script error:",
        runtimeScopeSelector,
        runtimeScopeCompositionId || scriptPayload.scopeCompositionId,
        authoredRootId,
      );
    } else {
      injectedScript.textContent = `(function(){${scriptPayload.content}})();`;
    }
    document.body.appendChild(injectedScript);
    params.injectedScripts.push(injectedScript);
    if (scriptPayload.kind === "external") {
      const loadResult = await waitForExternalScriptLoad(injectedScript);
      if (loadResult.status !== "load") {
        params.onDiagnostic?.({
          code: "external_composition_script_load_issue",
          details: {
            hostCompositionId: params.authoredCompositionId,
            runtimeCompositionId: params.runtimeCompositionId,
            hostCompositionSrc: params.hostCompositionSrc,
            resolvedScriptSrc: scriptPayload.src,
            loadStatus: loadResult.status,
            elapsedMs: loadResult.elapsedMs,
          },
        });
      }
    }
  }
}

export async function loadInlineTemplateCompositions(
  params: LoadExternalCompositionsParams,
): Promise<void> {
  const trackedHosts = getTrackedCompositionHosts();
  cleanupDetachedScopedVariables();
  if (trackedHosts.length === 0) return;
  const hostIdentityByElement = assignRuntimeCompositionIds(trackedHosts);
  const hosts = trackedHosts.filter((host) => {
    if (host.hasAttribute("data-composition-src")) return false;
    if (host.children.length > 0) return false;
    const compId = hostIdentityByElement.get(host)?.authoredCompositionId;
    if (!compId) return false;
    return !!document.querySelector(`template#${CSS.escape(compId)}-template`);
  });

  if (hosts.length === 0) return;

  for (const host of hosts) {
    const hostIdentity = hostIdentityByElement.get(host);
    const compId = hostIdentity?.authoredCompositionId;
    if (!compId) continue;
    const template = document.querySelector<HTMLTemplateElement>(
      `template#${CSS.escape(compId)}-template`,
    )!;

    resetCompositionHost(host);
    await mountCompositionContent({
      host,
      authoredCompositionId: compId,
      runtimeCompositionId: hostIdentity?.runtimeCompositionId || compId,
      hostCompositionSrc: `template#${compId}-template`,
      sourceNode: template.content,
      hasTemplate: true,
      fallbackBodyInnerHtml: "",
      compositionUrl: null,
      injectedStyles: params.injectedStyles,
      injectedScripts: params.injectedScripts,
      parseDimensionPx: params.parseDimensionPx,
      onDiagnostic: params.onDiagnostic,
    });
  }
}

export async function loadExternalCompositions(
  params: LoadExternalCompositionsParams,
): Promise<void> {
  const trackedHosts = getTrackedCompositionHosts();
  cleanupDetachedScopedVariables();
  if (trackedHosts.length === 0) return;
  const hostIdentityByElement = assignRuntimeCompositionIds(trackedHosts);
  const hosts = trackedHosts.filter((host) => host.hasAttribute("data-composition-src"));
  if (hosts.length === 0) return;

  await Promise.all(
    hosts.map(async (host) => {
      const src = host.getAttribute("data-composition-src");
      if (!src) return;
      const hostIdentity = hostIdentityByElement.get(host);
      const authoredCompositionId = hostIdentity?.authoredCompositionId || null;
      const runtimeCompositionId =
        hostIdentity?.runtimeCompositionId || authoredCompositionId || null;
      let compositionUrl: URL | null = null;
      try {
        compositionUrl = new URL(src, document.baseURI);
      } catch {
        compositionUrl = null;
      }
      resetCompositionHost(host);
      try {
        const localTemplate =
          authoredCompositionId != null
            ? document.querySelector<HTMLTemplateElement>(
                `template#${CSS.escape(authoredCompositionId)}-template`,
              )
            : null;
        if (localTemplate) {
          await mountCompositionContent({
            host,
            authoredCompositionId,
            runtimeCompositionId,
            hostCompositionSrc: src,
            sourceNode: localTemplate.content,
            hasTemplate: true,
            fallbackBodyInnerHtml: "",
            compositionUrl,
            injectedStyles: params.injectedStyles,
            injectedScripts: params.injectedScripts,
            parseDimensionPx: params.parseDimensionPx,
            onDiagnostic: params.onDiagnostic,
          });
          return;
        }
        const response = await fetch(src);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");
        const template =
          (authoredCompositionId
            ? doc.querySelector<HTMLTemplateElement>(
                `template#${CSS.escape(authoredCompositionId)}-template`,
              )
            : null) ?? doc.querySelector<HTMLTemplateElement>("template");
        const sourceNode = template ? template.content : doc.body;
        // When loading a non-template sub-composition (full HTML document),
        // extract <style> and <script> elements from the parsed document's
        // <head>. These contain critical CSS (backgrounds, positioning, fonts)
        // and library scripts (e.g. GSAP CDN) that would otherwise be lost
        // because mountCompositionContent only looks inside the composition
        // root element.
        const headStyles = !template
          ? Array.from(doc.head.querySelectorAll<HTMLStyleElement>("style"))
          : undefined;
        const headScripts = !template
          ? Array.from(doc.head.querySelectorAll<HTMLScriptElement>("script"))
          : undefined;
        await mountCompositionContent({
          host,
          authoredCompositionId,
          runtimeCompositionId,
          hostCompositionSrc: src,
          sourceNode,
          hasTemplate: Boolean(template),
          fallbackBodyInnerHtml: doc.body.innerHTML,
          compositionUrl,
          injectedStyles: params.injectedStyles,
          injectedScripts: params.injectedScripts,
          parseDimensionPx: params.parseDimensionPx,
          headStyles,
          headScripts,
          declaredVariableDefaults: readDeclaredDefaults(doc.documentElement),
          onDiagnostic: params.onDiagnostic,
        });
      } catch (error) {
        params.onDiagnostic?.({
          code: "external_composition_load_failed",
          details: {
            hostCompositionId: authoredCompositionId,
            runtimeCompositionId,
            hostCompositionSrc: src,
            errorMessage: error instanceof Error ? error.message : "unknown_error",
          },
        });
        // Keep host empty on load failures to avoid rendering escaped fallback HTML.
        resetCompositionHost(host);
      }
    }),
  );
}
