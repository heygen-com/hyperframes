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
    }
  | {
      kind: "external";
      src: string;
      type: string;
    };

const EXTERNAL_SCRIPT_LOAD_TIMEOUT_MS = 8000;
const BARE_RELATIVE_PATH_RE = /^(?![a-zA-Z][a-zA-Z\d+\-.]*:)(?!\/\/)(?!\/)(?!\.\.?\/).+/;

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

async function mountCompositionContent(params: {
  host: Element;
  hostCompositionId: string | null;
  hostCompositionSrc: string;
  sourceNode: ParentNode;
  hasTemplate: boolean;
  fallbackBodyInnerHtml: string;
  compositionUrl: URL | null;
  injectedStyles: HTMLStyleElement[];
  injectedScripts: HTMLScriptElement[];
  parseDimensionPx: (value: string | null) => string | null;
  onDiagnostic?: (payload: {
    code: string;
    details: Record<string, string | number | boolean | null | string[]>;
  }) => void;
}): Promise<void> {
  let innerRoot: Element | null = null;
  if (params.hostCompositionId) {
    const candidateRoots = Array.from(
      params.sourceNode.querySelectorAll<Element>("[data-composition-id]"),
    );
    innerRoot =
      candidateRoots.find(
        (candidate) => candidate.getAttribute("data-composition-id") === params.hostCompositionId,
      ) ?? null;
  }
  const contentNode = innerRoot ?? params.sourceNode;

  const styles = Array.from(contentNode.querySelectorAll<HTMLStyleElement>("style"));
  for (const style of styles) {
    const clonedStyle = style.cloneNode(true);
    if (!(clonedStyle instanceof HTMLStyleElement)) continue;
    document.head.appendChild(clonedStyle);
    params.injectedStyles.push(clonedStyle);
  }

  const scripts = Array.from(contentNode.querySelectorAll<HTMLScriptElement>("script"));
  const scriptPayloads: PendingScript[] = [];
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
    const imported = document.importNode(innerRoot, true) as HTMLElement;
    const widthRaw = innerRoot.getAttribute("data-width");
    const heightRaw = innerRoot.getAttribute("data-height");
    const widthPx = params.parseDimensionPx(widthRaw);
    const heightPx = params.parseDimensionPx(heightRaw);
    imported.style.position = "relative";
    imported.style.width = widthPx || "100%";
    imported.style.height = heightPx || "100%";
    if (widthPx) imported.style.setProperty("--comp-width", widthPx);
    if (heightPx) imported.style.setProperty("--comp-height", heightPx);
    if (widthRaw) params.host.setAttribute("data-width", widthRaw);
    if (heightRaw) params.host.setAttribute("data-height", heightRaw);
    if (widthPx && params.host instanceof HTMLElement) params.host.style.width = widthPx;
    if (heightPx && params.host instanceof HTMLElement) params.host.style.height = heightPx;
    params.host.appendChild(imported);
  } else if (params.hasTemplate) {
    params.host.appendChild(document.importNode(contentNode, true));
  } else {
    params.host.innerHTML = params.fallbackBodyInnerHtml;
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
            hostCompositionId: params.hostCompositionId,
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
  // Find all elements with data-composition-id but WITHOUT data-composition-src
  // that are empty (no children) and have a matching <template id="[compId]-template">
  const hosts = Array.from(
    document.querySelectorAll<Element>("[data-composition-id]:not([data-composition-src])"),
  ).filter((host) => {
    // Only process empty hosts (no meaningful content)
    if (host.children.length > 0) return false;
    const compId = host.getAttribute("data-composition-id");
    if (!compId) return false;
    // Check for matching template
    return !!document.querySelector(`template#${CSS.escape(compId)}-template`);
  });

  if (hosts.length === 0) return;

  for (const host of hosts) {
    const compId = host.getAttribute("data-composition-id")!;
    const template = document.querySelector<HTMLTemplateElement>(
      `template#${CSS.escape(compId)}-template`,
    )!;

    resetCompositionHost(host);
    await mountCompositionContent({
      host,
      hostCompositionId: compId,
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
  const hosts = Array.from(document.querySelectorAll("[data-composition-src]"));
  if (hosts.length === 0) return;

  await Promise.all(
    hosts.map(async (host) => {
      const src = host.getAttribute("data-composition-src");
      if (!src) return;
      let compositionUrl: URL | null = null;
      try {
        compositionUrl = new URL(src, document.baseURI);
      } catch {
        compositionUrl = null;
      }
      resetCompositionHost(host);
      try {
        const hostCompositionId = host.getAttribute("data-composition-id");
        const localTemplate =
          hostCompositionId != null
            ? document.querySelector<HTMLTemplateElement>(
                `template#${CSS.escape(hostCompositionId)}-template`,
              )
            : null;
        if (localTemplate) {
          await mountCompositionContent({
            host,
            hostCompositionId,
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
          (hostCompositionId
            ? doc.querySelector<HTMLTemplateElement>(
                `template#${CSS.escape(hostCompositionId)}-template`,
              )
            : null) ?? doc.querySelector<HTMLTemplateElement>("template");
        const sourceNode = template ? template.content : doc.body;
        await mountCompositionContent({
          host,
          hostCompositionId,
          hostCompositionSrc: src,
          sourceNode,
          hasTemplate: Boolean(template),
          fallbackBodyInnerHtml: doc.body.innerHTML,
          compositionUrl,
          injectedStyles: params.injectedStyles,
          injectedScripts: params.injectedScripts,
          parseDimensionPx: params.parseDimensionPx,
          onDiagnostic: params.onDiagnostic,
        });
      } catch (error) {
        params.onDiagnostic?.({
          code: "external_composition_load_failed",
          details: {
            hostCompositionId: host.getAttribute("data-composition-id"),
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
