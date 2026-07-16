import postcss, { type AtRule, type Node, type Rule } from "postcss";

const AUTHORED_ROOT_ID_ATTR = "data-hf-authored-id";
const INNER_ROOT_ATTR = "data-hf-inner-root";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeCssAttributeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escapeCssIdentifier(value: string): string {
  if (!value) return value;
  const escaped = value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
  return escaped.replace(/^-?\d/, (match) => `\\${match}`);
}

function getAuthoredRootIdSelectorForms(authoredRootId: string): string[] {
  const trimmed = authoredRootId.trim();
  if (!trimmed) return [];
  return Array.from(new Set([trimmed, escapeCssIdentifier(trimmed)])).filter(Boolean);
}

function isSelectorNameChar(char: string | undefined): boolean {
  return !!char && /[\w-]/.test(char);
}

function replaceAuthoredRootIdSelectors(
  selector: string,
  authoredRootId: string,
  replacement: string,
): string {
  const forms = getAuthoredRootIdSelectorForms(authoredRootId).sort((a, b) => b.length - a.length);
  if (forms.length === 0) return selector;

  let result = "";
  let bracketDepth = 0;
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < selector.length; index += 1) {
    const char = selector[index];
    const previousChar = index > 0 ? selector[index - 1] : "";

    if (quote) {
      result += char;
      if (char === quote && previousChar !== "\\") {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      result += char;
      continue;
    }

    if (char === "[") {
      bracketDepth += 1;
      result += char;
      continue;
    }

    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      result += char;
      continue;
    }

    if (char === "#" && bracketDepth === 0) {
      const matchedForm = forms.find((form) => selector.startsWith(form, index + 1));
      if (matchedForm) {
        const nextChar = selector[index + 1 + matchedForm.length];
        if (!isSelectorNameChar(nextChar)) {
          result += replacement;
          index += matchedForm.length;
          continue;
        }
      }
    }

    result += char;
  }

  return result;
}

function normalizeAuthoredRootIdSelector(selector: string, authoredRootId?: string | null): string {
  const trimmed = authoredRootId?.trim();
  if (!trimmed) return selector;
  return replaceAuthoredRootIdSelectors(
    selector,
    trimmed,
    `[${AUTHORED_ROOT_ID_ATTR}="${escapeCssAttributeValue(trimmed)}"]`,
  );
}

/** The composition's own box: the host when it renders content directly, or the
 *  flattened inner root when one is preserved below the host. Used both for a
 *  bare composition-root selector and for remapped document-level selectors.
 *  Relies on `:has()` (Chrome 105 / Safari 15.4 / Firefox 121) — an existing
 *  baseline for the bare-root case, noted here for new callers. */
function compositionBoxSelector(scope: string): string {
  return `${scope}:not(:has([${INNER_ROOT_ATTR}])), ${scope} > [${INNER_ROOT_ATTR}]`;
}

function scopeSelector(
  selector: string,
  scope: string,
  compositionId: string,
  authoredRootId?: string | null,
  compoundAuthoredRoot?: boolean,
  scopeRootSelectors?: boolean,
): string {
  const selectorWithoutAuthoredRootId = normalizeAuthoredRootIdSelector(selector, authoredRootId);
  const selectorWithoutRootTiming = normalizeCompositionRootSelector(
    selectorWithoutAuthoredRootId,
    scope,
    compositionId,
  );
  const trimmed = selectorWithoutRootTiming.trim();
  if (!trimmed) return selector;
  if (trimmed === "*") return selector;
  if (/^(html|body|:root)$/i.test(trimmed)) {
    // A mounted/inlined sub-comp's document-level selectors must not style the
    // PARENT (a sub-comp `body { width/height/overflow }` would clobber the host
    // <body> and clip the preview/render). Remap to the comp's own box. A
    // top-level compile (scopeRootSelectors falsy) legitimately owns the document.
    //
    // Coverage is intentionally BARE-only: compound forms (`body.dark`,
    // `body[data-theme]`, `body:hover`, `html body`, `:root .x`) fall through to
    // general scoping below. That is byte-identical to pre-fix behavior — those
    // selectors never matched the parent <body> (it has no data-composition-id),
    // so there was no clobber to fix. The bare forms are the ones that actually
    // caused the parent-body clobber, which is what this remap targets.
    return scopeRootSelectors ? compositionBoxSelector(scope) : selector;
  }
  const compositionIdPattern = new RegExp(
    `\\[\\s*data-composition-id\\s*=\\s*(["'])${escapeRegExp(compositionId)}\\1\\s*\\]`,
    "g",
  );
  if (compositionIdPattern.test(trimmed)) {
    const isRootBoxSelector = trimmed.replace(compositionIdPattern, "").trim() === "";
    if (isRootBoxSelector) {
      // A bare root selector styles the composition's own box (flex/grid/
      // position/padding). When flattenInnerRoot preserves the authored root
      // as a wrapper below `scope` (see prepareFlattenedInnerRoot), that
      // wrapper is the element real children are laid out in, not `scope`
      // itself, so the box styling must land there instead. It must land on
      // exactly one of the two: applying it to both compounds any additive
      // property (padding, margin, non-zero transform) since the wrapper
      // sits nested inside the host and would inherit the effect twice.
      return compositionBoxSelector(scope);
    }
    return selectorWithoutRootTiming.replace(compositionIdPattern, scope);
  }
  const leading = selectorWithoutRootTiming.match(/^\s*/)?.[0] ?? "";
  const trailing = selectorWithoutRootTiming.match(/\s*$/)?.[0] ?? "";
  if (compoundAuthoredRoot) {
    const authoredRootAttr = authoredRootId
      ? `[${AUTHORED_ROOT_ID_ATTR}="${escapeCssAttributeValue(authoredRootId)}"]`
      : null;
    if (authoredRootAttr && trimmed.startsWith(authoredRootAttr)) {
      const rest = trimmed.slice(authoredRootAttr.length);
      return `${leading}${scope}${authoredRootAttr}${rest}${trailing}`;
    }
  }
  return `${leading}${scope} ${trimmed}${trailing}`;
}

function normalizeCompositionRootSelector(
  selector: string,
  scope: string,
  compositionId: string,
): string {
  const quotedCompId = escapeRegExp(compositionId);
  const compAttr = String.raw`\[\s*data-composition-id\s*=\s*(?:"${quotedCompId}"|'${quotedCompId}')\s*\]`;
  const timingAttr = String.raw`\s*\[\s*data-(?:start|duration)\s*=\s*(?:"[^"]*"|'[^']*')\s*\]`;
  return selector
    .replace(new RegExp(`${compAttr}(?:${timingAttr})+`, "g"), scope)
    .replace(new RegExp(`(?:${timingAttr})+${compAttr}`, "g"), scope);
}

const GLOBAL_AT_RULES = new Set(["keyframes", "-webkit-keyframes", "font-face"]);

function isAtRuleNode(node: Node["parent"]): node is AtRule {
  return node?.type === "atrule";
}

function isInsideGlobalAtRule(rule: Rule): boolean {
  let current: Node["parent"] = rule.parent;
  while (current) {
    if (isAtRuleNode(current) && GLOBAL_AT_RULES.has(current.name.toLowerCase())) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

export function scopeCssToComposition(
  css: string,
  compositionId: string,
  scopeSelectorOverride?: string,
  authoredRootId?: string | null,
  options?: { compoundAuthoredRoot?: boolean; scopeRootSelectors?: boolean },
): string {
  const trimmedCompositionId = compositionId.trim();
  if (!css || !trimmedCompositionId) return css;
  const scope =
    scopeSelectorOverride ||
    `[data-composition-id="${escapeCssAttributeValue(trimmedCompositionId)}"]`;
  const root = postcss.parse(css);

  root.walkRules((rule) => {
    if (isInsideGlobalAtRule(rule)) return;
    rule.selectors = rule.selectors.map((selector) =>
      scopeSelector(
        selector,
        scope,
        trimmedCompositionId,
        authoredRootId,
        options?.compoundAuthoredRoot,
        options?.scopeRootSelectors,
      ),
    );
  });

  return root.toResult({ map: false }).css;
}

export function wrapScopedCompositionScript(
  source: string,
  compositionId: string,
  errorLabel = "[HyperFrames] composition script error:",
  scopeSelectorOverride?: string,
  timelineCompositionId = compositionId,
  authoredRootId?: string | null,
): string {
  const compositionIdLiteral = JSON.stringify(compositionId);
  const timelineCompositionIdLiteral = JSON.stringify(timelineCompositionId);
  const errorLabelLiteral = JSON.stringify(errorLabel);
  const escapedCompositionId = escapeRegExp(compositionId);
  const authoredRootIdLiteral = JSON.stringify(authoredRootId?.trim() || null);
  const scopeSelectorLiteral = JSON.stringify(scopeSelectorOverride ?? null);
  const rootSelectorPatternLiteral = JSON.stringify(
    String.raw`\[\s*data-composition-id\s*=\s*(?:"${escapedCompositionId}"|'${escapedCompositionId}')\s*\]`,
  );
  const timingSelectorPatternLiteral = JSON.stringify(
    String.raw`\s*\[\s*data-(?:start|duration)\s*=\s*(?:"[^"]*"|'[^']*')\s*\]`,
  );
  const authoredRootIdFormsLiteral = JSON.stringify(
    getAuthoredRootIdSelectorForms(authoredRootId?.trim() || ""),
  );
  return `(function(){
  var __hfCompId = ${compositionIdLiteral};
  var __hfTimelineCompId = ${timelineCompositionIdLiteral};
  var __hfErrorLabel = ${errorLabelLiteral};
  var __hfAuthoredRootId = ${authoredRootIdLiteral};
  var __hfAuthoredRootAttr = ${JSON.stringify(AUTHORED_ROOT_ID_ATTR)};
  var __hfEscapeAttr = function(value) {
    return (value + "").replace(/\\\\/g, "\\\\\\\\").replace(/"/g, "\\\\\\"");
  };
  var __hfRootSelector = ${scopeSelectorLiteral} || (__hfCompId
    ? '[data-composition-id="' + __hfEscapeAttr(__hfCompId) + '"]'
    : "");
  var __hfRoot = null;
  var __hfRootSelectorPattern = ${rootSelectorPatternLiteral};
  var __hfTimingSelectorPattern = ${timingSelectorPatternLiteral};
  var __hfAuthoredRootIdForms = ${authoredRootIdFormsLiteral};
  var __hfAuthoredRootSelector = __hfAuthoredRootId
    ? "[" + __hfAuthoredRootAttr + '="' + __hfEscapeAttr(__hfAuthoredRootId) + '"]'
    : "";
  var __hfIsSelectorNameChar = function(char) {
    return !!char && /[\\w-]/.test(char);
  };
  var __hfReplaceAuthoredRootIdSelectors = function(selector) {
    if (!__hfAuthoredRootSelector || !__hfAuthoredRootIdForms.length || typeof selector !== "string") {
      return selector;
    }
    var result = "";
    var bracketDepth = 0;
    var quote = null;
    for (var index = 0; index < selector.length; index += 1) {
      var char = selector[index];
      var previousChar = index > 0 ? selector[index - 1] : "";
      if (quote) {
        result += char;
        if (char === quote && previousChar !== "\\\\") {
          quote = null;
        }
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        result += char;
        continue;
      }
      if (char === "[") {
        bracketDepth += 1;
        result += char;
        continue;
      }
      if (char === "]") {
        bracketDepth = Math.max(0, bracketDepth - 1);
        result += char;
        continue;
      }
      if (char === "#" && bracketDepth === 0) {
        var matchedForm = null;
        for (var formIndex = 0; formIndex < __hfAuthoredRootIdForms.length; formIndex += 1) {
          var form = __hfAuthoredRootIdForms[formIndex];
          if (selector.slice(index + 1, index + 1 + form.length) === form) {
            matchedForm = form;
            break;
          }
        }
        if (matchedForm) {
          var nextChar = selector[index + 1 + matchedForm.length];
          if (!__hfIsSelectorNameChar(nextChar)) {
            result += __hfAuthoredRootSelector;
            index += matchedForm.length;
            continue;
          }
        }
      }
      result += char;
    }
    return result;
  };
  var __hfNormalizeSelector = function(selector) {
    if (!__hfCompId || typeof selector !== "string") return selector;
    var normalized = selector
      .replace(new RegExp(__hfRootSelectorPattern + '(?:' + __hfTimingSelectorPattern + ')+', 'g'), __hfRootSelector)
      .replace(new RegExp('(?:' + __hfTimingSelectorPattern + ')+' + __hfRootSelectorPattern, 'g'), __hfRootSelector);
    if (__hfAuthoredRootSelector) {
      normalized = __hfReplaceAuthoredRootIdSelectors(normalized);
    }
    return normalized;
  };
  var __hfFindRoot = function() {
    if (!__hfRoot && __hfRootSelector) {
      __hfRoot = window.document.querySelector(__hfRootSelector);
    }
    return __hfRoot;
  };
  var __hfContains = function(node) {
    var root = __hfFindRoot();
    return !root || node === root || root.contains(node);
  };
  var __hfQueryAll = function(selector) {
    var root = __hfFindRoot();
    if (!root || typeof selector !== "string") {
      return window.document.querySelectorAll(selector);
    }
    return Array.prototype.filter.call(window.document.querySelectorAll(__hfNormalizeSelector(selector)), function(node) {
      return __hfContains(node);
    });
  };
  var __hfQueryOne = function(selector) {
    var matches = __hfQueryAll(selector);
    return matches[0] || null;
  };
  var __hfGetElementById = function(id) {
    var found = window.document.getElementById(id);
    if (found && __hfContains(found)) return found;
    var root = __hfFindRoot();
    if (!root) return found || null;
    var idValue = id + "";
    if (__hfAuthoredRootId && __hfAuthoredRootId === idValue && root.getAttribute && root.getAttribute(__hfAuthoredRootAttr) === idValue) {
      return root;
    }
    if (root.id === idValue) return root;
    if (typeof root.querySelector !== "function") return null;
    try {
      var authoredRootMatch = root.querySelector('[' + __hfAuthoredRootAttr + '="' + __hfEscapeAttr(idValue) + '"]');
      if (authoredRootMatch) return authoredRootMatch;
    } catch {}
    if (typeof CSS !== "undefined" && CSS && typeof CSS.escape === "function") {
      try {
        return root.querySelector("#" + CSS.escape(idValue)) || null;
      } catch {}
    }
    try {
      return root.querySelector('[id="' + __hfEscapeAttr(idValue) + '"]') || null;
    } catch {}
    return null;
  };
  var __hfScopedDocument = typeof Proxy === "function"
    ? new Proxy(window.document, {
        get: function(target, prop, receiver) {
          if (prop === "querySelector") return __hfQueryOne;
          if (prop === "querySelectorAll") return __hfQueryAll;
          if (prop === "getElementById") return __hfGetElementById;
          var value = Reflect.get(target, prop, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      })
    : window.document;
  var __hfTimelineRegistryProxy = null;
  var __hfGetTimelineRegistry = function() {
    window.__timelines = window.__timelines || {};
    if (!__hfCompId || __hfCompId === __hfTimelineCompId || typeof Proxy !== "function") {
      return window.__timelines;
    }
    if (!__hfTimelineRegistryProxy) {
      __hfTimelineRegistryProxy = new Proxy(window.__timelines, {
        get: function(target, prop, receiver) {
          if (prop !== __hfCompId) {
            return Reflect.get(target, prop, target);
          }
          var authoredValue = Reflect.get(target, prop, target);
          return authoredValue === undefined
            ? Reflect.get(target, __hfTimelineCompId, target)
            : authoredValue;
        },
        set: function(target, prop, value, receiver) {
          if (prop !== __hfCompId) {
            return Reflect.set(target, prop, value, target);
          }
          // The authored node remains in the compiled DOM when its local id
          // differs from the runtime mount id, so readiness legitimately sees
          // both compositions. Publish the same timeline under both identities
          // instead of replacing one with the other.
          var authoredSet = Reflect.set(target, __hfCompId, value, target);
          var runtimeSet = Reflect.set(target, __hfTimelineCompId, value, target);
          return authoredSet && runtimeSet;
        },
      });
    }
    return __hfTimelineRegistryProxy;
  };
  var __hfScopedWindow = typeof Proxy === "function"
    ? new Proxy(window, {
        get: function(target, prop, receiver) {
          if (prop === "__timelines") return __hfGetTimelineRegistry();
          // Inside a sub-composition, __hyperframes is passed as a bare script
          // param bound to the SCOPED variant (per-comp getVariables). But
          // authors routinely write the documented window.__hyperframes.
          // getVariables() form, which would otherwise fall through to the host
          // page's base __hyperframes and return the WRONG (or empty) variables
          // for this instance. Route it to the scoped variant too so both
          // spellings resolve to this composition's own variables.
          // (__hfScopedHyperframes is a hoisted var assigned below, before any
          // sub-comp script -- the only code that reads this -- runs.)
          if (prop === "__hyperframes") return __hfScopedHyperframes;
          return Reflect.get(target, prop, target);
        },
        set: function(target, prop, value, receiver) {
          if (prop === "__timelines") {
            // Common authoring boilerplate assigns the registry back to
            // itself (window.__timelines = window.__timelines || {}). The
            // getter above returns our proxy; do not replace the canonical
            // registry with that proxy or later wrappers will stack proxies.
            if (value === __hfTimelineRegistryProxy) return true;
            target.__timelines = value || {};
            __hfTimelineRegistryProxy = null;
            return true;
          }
          return Reflect.set(target, prop, value, target);
        },
      })
    : window;
  var __hfResolveGsapTarget = function(target) {
    if (typeof target !== "string") return target;
    return __hfQueryAll(target);
  };
  var __hfScopeTimeline = function(timeline) {
    if (!timeline || timeline.__hfScopedCompositionRoot === __hfFindRoot()) return timeline;
    ["to", "from", "fromTo", "set"].forEach(function(method) {
      var original = timeline[method];
      if (typeof original !== "function") return;
      timeline[method] = function(target) {
        var args = Array.prototype.slice.call(arguments);
        args[0] = __hfResolveGsapTarget(target);
        return original.apply(timeline, args);
      };
    });
    try {
      Object.defineProperty(timeline, "__hfScopedCompositionRoot", {
        value: __hfFindRoot(),
        configurable: true,
      });
    } catch {
      // Best-effort: timelines coming from user code may have a frozen target
      // or a non-extensible defineProperty path. Swallow — the scoped root
      // is an enrichment, not a correctness invariant for playback.
    }
    return timeline;
  };
  var __hfBaseGsap = typeof gsap === "undefined" ? window.gsap : gsap;
  var __hfScopedGsap = !__hfBaseGsap || typeof Proxy !== "function"
    ? __hfBaseGsap
    : new Proxy(__hfBaseGsap, {
        get: function(target, prop, receiver) {
          if (prop === "timeline") {
            return function() {
              return __hfScopeTimeline(target.timeline.apply(target, arguments));
            };
          }
          if (prop === "to" || prop === "from" || prop === "fromTo" || prop === "set") {
            return function(firstArg) {
              var args = Array.prototype.slice.call(arguments);
              args[0] = __hfResolveGsapTarget(firstArg);
              return target[prop].apply(target, args);
            };
          }
          if (prop === "utils" && target.utils && typeof Proxy === "function") {
            return new Proxy(target.utils, {
              get: function(utilsTarget, utilsProp, utilsReceiver) {
                if (utilsProp === "toArray") {
                  return function(firstArg) {
                    var args = Array.prototype.slice.call(arguments);
                    args[0] = __hfResolveGsapTarget(firstArg);
                    return utilsTarget.toArray.apply(utilsTarget, args);
                  };
                }
                if (utilsProp === "selector") {
                  return function(base) {
                    var baseEl = typeof base === "string" ? __hfQueryOne(base) : base;
                    var root = baseEl || __hfFindRoot();
                    return function(selector) {
                      if (!root || typeof selector !== "string") return [];
                      return Array.prototype.filter.call(
                        window.document.querySelectorAll(__hfNormalizeSelector(selector)),
                        function(node) {
                          return node === root || (typeof root.contains === "function" && root.contains(node));
                        },
                      );
                    };
                  };
                }
                var value = Reflect.get(utilsTarget, utilsProp, utilsTarget);
                return typeof value === "function" ? value.bind(utilsTarget) : value;
              },
            });
          }
          var value = Reflect.get(target, prop, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
  var __hfBaseHyperframes = window.__hyperframes;
  var __hfScopedHyperframes = !__hfBaseHyperframes
    ? __hfBaseHyperframes
    : Object.assign({}, __hfBaseHyperframes, {
        getVariables: function() {
          var byComp = window.__hfVariablesByComp;
          var scoped = byComp && __hfTimelineCompId ? byComp[__hfTimelineCompId] : null;
          return scoped ? Object.assign({}, scoped) : {};
        },
      });
  var __hfRun = function() {
    try {
      (function(document, gsap, window, __hyperframes) {
${source.replace(/<\/(script)/gi, "<\\/$1")}
      }).call(window, __hfScopedDocument, __hfScopedGsap, __hfScopedWindow, __hfScopedHyperframes);
    } catch (_err) {
      console.error(__hfErrorLabel, __hfCompId, _err);
    }
  };
  __hfFindRoot();
  __hfRun();
})();`;
}

export function wrapInlineScriptWithErrorBoundary(source: string, errorLabel: string): string {
  return `(function(){ try { Function(${JSON.stringify(source)}).call(window); } catch (_err) { console.error(${JSON.stringify(errorLabel)}, _err); } })();`;
}

/**
 * Build the statement that populates `window.__hfVariablesByComp` — the table
 * the scoped `getVariables` above reads. Returns `null` when there are no
 * per-instance values.
 *
 * The WRITER lives next to the READER (the scoped `getVariables` in
 * `wrapScopedCompositionScript`) on purpose: every compile path that wraps the
 * reader MUST also emit this writer before the sub-comp scripts run. The
 * render compiler (`htmlCompiler`) inlined the reader scripts but never emitted
 * the writer while the preview bundler (`htmlBundler`) did, so
 * `getVariables()` returned `{}` only during render — parametrized sub-comps
 * silently shipped blank/default text in the final MP4 while snapshot QA passed
 * (issue #2064). Both callers now share this one builder so they can't drift.
 */
export function buildVariablesByCompScript(
  variablesByComp: Record<string, Record<string, unknown>>,
): string | null {
  if (!variablesByComp || Object.keys(variablesByComp).length === 0) return null;
  return `window.__hfVariablesByComp = Object.assign({}, window.__hfVariablesByComp || {}, ${JSON.stringify(variablesByComp)});`;
}
