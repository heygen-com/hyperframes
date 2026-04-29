import postcss, { type AtRule, type Node, type Rule } from "postcss";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeCssAttributeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function scopeSelector(selector: string, scope: string, compositionId: string): string {
  const selectorWithoutRootTiming = normalizeCompositionRootSelector(
    selector,
    scope,
    compositionId,
  );
  const trimmed = selectorWithoutRootTiming.trim();
  if (!trimmed) return selector;
  if (/^(html|body|:root|\*)$/i.test(trimmed)) return selector;
  const compositionIdPattern = new RegExp(
    `\\[\\s*data-composition-id\\s*=\\s*(["'])${escapeRegExp(compositionId)}\\1\\s*\\]`,
    "g",
  );
  if (compositionIdPattern.test(trimmed)) {
    return selectorWithoutRootTiming.replace(compositionIdPattern, scope);
  }
  const leading = selectorWithoutRootTiming.match(/^\s*/)?.[0] ?? "";
  const trailing = selectorWithoutRootTiming.match(/\s*$/)?.[0] ?? "";
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
      scopeSelector(selector, scope, trimmedCompositionId),
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
): string {
  const compositionIdLiteral = JSON.stringify(compositionId);
  const timelineCompositionIdLiteral = JSON.stringify(timelineCompositionId);
  const errorLabelLiteral = JSON.stringify(errorLabel);
  const escapedCompositionId = escapeRegExp(compositionId);
  const scopeSelectorLiteral = JSON.stringify(scopeSelectorOverride ?? null);
  const rootSelectorPatternLiteral = JSON.stringify(
    String.raw`\[\s*data-composition-id\s*=\s*(?:"${escapedCompositionId}"|'${escapedCompositionId}')\s*\]`,
  );
  const timingSelectorPatternLiteral = JSON.stringify(
    String.raw`\s*\[\s*data-(?:start|duration)\s*=\s*(?:"[^"]*"|'[^']*')\s*\]`,
  );
  return `(function(){
  var __hfCompId = ${compositionIdLiteral};
  var __hfTimelineCompId = ${timelineCompositionIdLiteral};
  var __hfErrorLabel = ${errorLabelLiteral};
  var __hfEscapeAttr = function(value) {
    return (value + "").replace(/\\\\/g, "\\\\\\\\").replace(/"/g, "\\\\\\"");
  };
  var __hfRootSelector = ${scopeSelectorLiteral} || (__hfCompId
    ? '[data-composition-id="' + __hfEscapeAttr(__hfCompId) + '"]'
    : "");
  var __hfRoot = null;
  var __hfRootSelectorPattern = ${rootSelectorPatternLiteral};
  var __hfTimingSelectorPattern = ${timingSelectorPatternLiteral};
  var __hfNormalizeSelector = function(selector) {
    if (!__hfCompId || typeof selector !== "string") return selector;
    return selector
      .replace(new RegExp(__hfRootSelectorPattern + '(?:' + __hfTimingSelectorPattern + ')+', 'g'), __hfRootSelector)
      .replace(new RegExp('(?:' + __hfTimingSelectorPattern + ')+' + __hfRootSelectorPattern, 'g'), __hfRootSelector);
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
  var __hfScopedDocument = typeof Proxy === "function"
    ? new Proxy(window.document, {
        get: function(target, prop, receiver) {
          if (prop === "querySelector") return __hfQueryOne;
          if (prop === "querySelectorAll") return __hfQueryAll;
          if (prop === "getElementById") {
            return function(id) {
              var found = target.getElementById(id);
              return found && __hfContains(found) ? found : null;
            };
          }
          var value = Reflect.get(target, prop, receiver);
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
          return Reflect.get(target, prop === __hfCompId ? __hfTimelineCompId : prop, receiver);
        },
        set: function(target, prop, value, receiver) {
          return Reflect.set(target, prop === __hfCompId ? __hfTimelineCompId : prop, value, receiver);
        },
      });
    }
    return __hfTimelineRegistryProxy;
  };
  var __hfScopedWindow = typeof Proxy === "function"
    ? new Proxy(window, {
        get: function(target, prop, receiver) {
          if (prop === "__timelines") return __hfGetTimelineRegistry();
          var value = Reflect.get(target, prop, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
        set: function(target, prop, value, receiver) {
          if (prop === "__timelines") {
            target.__timelines = value || {};
            __hfTimelineRegistryProxy = null;
            return true;
          }
          return Reflect.set(target, prop, value, receiver);
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
    } catch (_err) {}
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
                      return Array.prototype.slice.call(root.querySelectorAll(selector));
                    };
                  };
                }
                var value = Reflect.get(utilsTarget, utilsProp, utilsReceiver);
                return typeof value === "function" ? value.bind(utilsTarget) : value;
              },
            });
          }
          var value = Reflect.get(target, prop, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
  var __hfRun = function() {
    try {
      (function(document, gsap, window) {
${source}
      }).call(window, __hfScopedDocument, __hfScopedGsap, __hfScopedWindow);
    } catch (_err) {
      console.error(__hfErrorLabel, __hfCompId, _err);
    }
  };
  __hfFindRoot();
  __hfRun();
})()`;
}
