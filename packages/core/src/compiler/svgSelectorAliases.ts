import * as tokens from "./selectorIdTokens";
export const SVG_REFERENCE_ALIASES_ATTR = "data-hf-svg-reference-aliases";

export interface SvgReferenceAlias {
  name: string;
  localName: string;
  namespaceURI: string | null;
  before: string;
  after: string;
}

interface IdSelectorAlias {
  id: string;
  replacement: string;
}

const lower = (text: string) => text.replace(/[A-Z]/g, (char) => char.toLowerCase());

interface AttributeAliases {
  all: SvgReferenceAlias[];
  byBefore: Map<string, SvgReferenceAlias[]>;
  byLowercaseBefore: Map<string, SvgReferenceAlias[]>;
}

interface AliasIndex {
  everyRecordedId: Set<string>;
  renamedIdAlternatives: Map<string, string>;
  byName: Map<string, AttributeAliases>;
  byLocalName: Map<string, AttributeAliases>;
}

// A scope's alias list is read once and then only passed around, so its index is built once per list.
const aliasIndexes = new WeakMap<readonly SvgReferenceAlias[], AliasIndex>();

function aliasIndex(references: readonly SvgReferenceAlias[]): AliasIndex {
  let index = aliasIndexes.get(references);
  if (index) return index;
  index = {
    everyRecordedId: new Set(),
    renamedIdAlternatives: new Map(),
    byName: new Map(),
    byLocalName: new Map(),
  };
  const ids = new Map<string, Set<string>>();
  const add = (map: Map<string, AttributeAliases>, name: string, alias: SvgReferenceAlias) => {
    let entry = map.get(lower(name));
    if (!entry)
      map.set(
        lower(name),
        (entry = { all: [], byBefore: new Map(), byLowercaseBefore: new Map() }),
      );
    entry.all.push(alias);
    for (const [values, key] of [
      [entry.byBefore, alias.before],
      [entry.byLowercaseBefore, lower(alias.before)],
    ] as const) {
      const same = values.get(key);
      if (same) same.push(alias);
      else values.set(key, [alias]);
    }
  };
  for (const alias of references) {
    if (alias.name === "id") index.everyRecordedId.add(alias.before);
    if (alias.before === alias.after) continue;
    add(index.byName, alias.name, alias);
    add(index.byLocalName, alias.localName, alias);
    if (alias.name !== "id") continue;
    let targets = ids.get(alias.before);
    if (!targets)
      ids.set(alias.before, (targets = new Set([`#${tokens.escapeCssIdentifier(alias.before)}`])));
    targets.add(`#${tokens.escapeCssIdentifier(alias.after)}`);
  }
  for (const [id, targets] of ids)
    index.renamedIdAlternatives.set(id, `:is(${[...targets].join(", ")})`);
  aliasIndexes.set(references, index);
  return index;
}

export function recordedSvgIds(references: readonly SvgReferenceAlias[]): ReadonlySet<string> {
  return aliasIndex(references).everyRecordedId;
}

/**
 * With `namespaces` (a live sheet's bindings) only prefixed attribute selectors are
 * rewritten; without it they stay as authored and everything else is rewritten.
 */
export function rewriteSvgSelectors(
  selector: string,
  ids: readonly IdSelectorAlias[],
  references: readonly SvgReferenceAlias[],
  namespaces?: ReadonlyMap<string, string | null>,
): string {
  type AttributeOperator = NonNullable<
    ReturnType<typeof tokens.parseAttributeSelector>
  >["operator"];
  const attributeOperators = {
    "=": (before, value) => before === value,
    "~=": (before, value) => before.split(/[ \t\r\n\f]+/).includes(value),
    "|=": (before, value) => before === value || before.startsWith(value + "-"),
    "^=": (before, value) => before.startsWith(value),
    "$=": (before, value) => before.endsWith(value),
    "*=": (before, value) => before.includes(value),
  } satisfies Record<AttributeOperator, (before: string, value: string) => boolean>;
  const matchesValue = (before: string, value: string, operator: AttributeOperator): boolean => {
    if (!value && operator !== "=" && operator !== "|=") return false;
    return attributeOperators[operator](before, value);
  };
  const index = aliasIndex(references);
  const rewriteAttribute = (predicate: string): string => {
    const parsed = tokens.parseAttributeSelector(predicate);
    if (!parsed) return predicate;
    const { name, rawName, namespace, operator, value, flag } = parsed;
    if ((namespace.kind === "named") !== (namespaces !== undefined)) return predicate;
    const folded = flag?.toLowerCase() === "i";
    const fold = folded ? lower : (text: string) => text;
    const forName = (namespace.kind === "none" ? index.byName : index.byLocalName).get(lower(name));
    if (!forName) return predicate;
    const byValue = folded
      ? forName.byLowercaseBefore.get(lower(value))
      : forName.byBefore.get(value);
    const uri = namespace.kind === "named" ? namespaces!.get(namespace.prefix) : null;
    const candidates = ((operator === "=" ? byValue : forName.all) ?? []).filter(
      (reference) => namespace.kind === "any" || reference.namespaceURI === uri,
    );
    const alternatives = new Set([predicate]);
    for (const reference of candidates) {
      if (!matchesValue(fold(reference.before), fold(value), operator)) continue;
      alternatives.add(
        `[${rawName}="${tokens.escapeCssAttributeValue(reference.after)}"${flag ? ` ${flag}` : ""}]`,
      );
    }
    return alternatives.size === 1 ? predicate : `:is(${[...alternatives].join(", ")})`;
  };
  if (namespaces) return tokens.replaceSelectorAttributeTokens(selector, rewriteAttribute);
  const replacements = new Map(ids.map(({ id, replacement }) => [id, replacement]));
  const namedIds = tokens
    .selectorIdTokens(selector)
    .filter((id) => replacements.has(id) || index.renamedIdAlternatives.has(id));
  const rewrittenIds = tokens.replaceSelectorIdTokens(
    selector,
    namedIds,
    (id) => replacements.get(id) ?? index.renamedIdAlternatives.get(id)!,
  );
  return tokens.replaceSelectorAttributeTokens(rewrittenIds, rewriteAttribute);
}

/** Metadata records actual writes; selectors still match current native attribute values. */
export function readSvgReferenceAliases(
  root: {
    querySelectorAll(selector: string): Iterable<Element>;
    getAttribute?: (name: string) => string | null;
  },
  attribute: string,
  includeDescendants = true,
): SvgReferenceAlias[] {
  const aliases: SvgReferenceAlias[] = [];
  const nodes = includeDescendants ? [...root.querySelectorAll(`[${attribute}]`)] : [];
  const texts = nodes.map((node) => node.getAttribute(attribute)!);
  const own = root.getAttribute?.(attribute);
  if (own) texts.unshift(own);
  for (const text of texts) {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      continue; // authored HTML can carry this attribute; a bad value must not stop boot
    }
    if (!Array.isArray(value)) continue;
    const entries: unknown[] = value;
    for (const entry of entries) {
      if (!isSvgReferenceAlias(entry)) continue;
      const { name, localName, namespaceURI, before, after } = entry;
      aliases.push({ name, localName, namespaceURI, before, after });
    }
  }
  return aliases;
}

function isSvgReferenceAlias(entry: unknown): entry is SvgReferenceAlias {
  if (!entry || typeof entry !== "object") return false;
  const { name, localName, namespaceURI, before, after } = entry as Record<string, unknown>;
  return (
    typeof name === "string" &&
    typeof localName === "string" &&
    (namespaceURI === null || typeof namespaceURI === "string") &&
    typeof before === "string" &&
    typeof after === "string"
  );
}

export interface SvgSelectorAliases {
  refresh(): void;
  rewrite(selector: string, additional?: readonly IdSelectorAlias[]): string;
}

type AliasWindow = Pick<Window, "document"> & {
  Element: typeof Element;
  __hfSvgSelectorAliases?: SvgSelectorAliases;
};

function installSvgSelectorAliases(win: AliasWindow): void {
  let ids: IdSelectorAlias[] = [];
  let references: SvgReferenceAlias[] = [];
  let installed = false;
  let validateSyntax: ((selector: string) => boolean) | undefined;
  const ruleSelectors = new WeakMap<CSSStyleRule, { authored: string; applied: string }>();
  const repairRules = (rules: CSSRuleList, namespaces: ReadonlyMap<string, string | null>) => {
    for (const rule of rules) {
      if ("selectorText" in rule) {
        const styleRule = rule as CSSStyleRule;
        const record = ruleSelectors.get(styleRule);
        const current = styleRule.selectorText;
        const authored = record?.applied === current ? record.authored : current;
        const next = rewriteSvgSelectors(authored, [], references, namespaces);
        if (next !== current) styleRule.selectorText = next;
        if (next === authored) ruleSelectors.delete(styleRule);
        else ruleSelectors.set(styleRule, { authored, applied: styleRule.selectorText });
      }
      if ("cssRules" in rule) repairRules((rule as CSSGroupingRule).cssRules, namespaces);
    }
  };
  // Only the browser knows which @namespace rules a sheet kept, so prefixed attribute
  // selectors are repaired in the live CSSOM; compiled CSS text leaves them as authored.
  const repairNamespacedSelectors = () => {
    if (!references.length) return;
    for (const sheet of win.document.styleSheets) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // cross-origin sheets are unreadable by design
      }
      const namespaces = new Map<string, string | null>();
      for (const rule of rules) {
        if (!("namespaceURI" in rule)) continue;
        const { prefix, namespaceURI } = rule as CSSNamespaceRule;
        if (prefix) namespaces.set(prefix, namespaceURI || null);
      }
      if (namespaces.size) repairRules(rules, namespaces);
    }
  };
  const aliases: SvgSelectorAliases = {
    rewrite: (selector, additional = []) => {
      if (typeof selector !== "string" || (!selector.includes("#") && !selector.includes("[")))
        return selector;
      const rewritten = rewriteSvgSelectors(
        selector,
        additional.length ? [...additional, ...ids] : ids,
        references,
      );
      if (rewritten !== selector) {
        if (!validateSyntax) {
          const syntaxProbe = win.document.createElement("div");
          validateSyntax = syntaxProbe.matches.bind(syntaxProbe);
        }
        validateSyntax(selector);
      }
      return rewritten;
    },
    refresh() {
      references = readSvgReferenceAliases(win.document, SVG_REFERENCE_ALIASES_ATTR).filter(
        (alias) => alias.before !== alias.after,
      );
      const recordedIds = new Set(
        references.filter((alias) => alias.name === "id").map((alias) => alias.before),
      );
      const seen = new Set<string>();
      ids = [];
      for (const node of win.document.querySelectorAll("[data-hf-authored-id][id]")) {
        const authored = node.getAttribute("data-hf-authored-id")!;
        if (!authored || authored === node.id || seen.has(authored) || recordedIds.has(authored))
          continue;
        seen.add(authored);
        const value = tokens.escapeCssAttributeValue(authored);
        ids.push({
          id: authored,
          replacement: `:is(#${tokens.escapeCssIdentifier(authored)}, [data-hf-authored-id="${value}"])`,
        });
      }
      repairNamespacedSelectors();
      if (installed || (!ids.length && !references.length)) return;
      const proto = win.Element.prototype;
      proto.querySelector = new Proxy(proto.querySelector, {
        apply(target, thisArg, args) {
          return Reflect.apply(target, thisArg, [aliases.rewrite(args[0])]);
        },
      });
      proto.querySelectorAll = new Proxy(proto.querySelectorAll, {
        apply(target, thisArg, args) {
          return Reflect.apply(target, thisArg, [aliases.rewrite(args[0])]);
        },
      });
      installed = true;
    },
  };
  win.__hfSvgSelectorAliases = aliases;
  aliases.refresh();
}

export function refreshSvgSelectorAliases(): void {
  const win: AliasWindow = window;
  if (win.__hfSvgSelectorAliases) win.__hfSvgSelectorAliases.refresh();
  else installSvgSelectorAliases(win);
}

/** Compiled scene scripts install once; refreshes stay with the runtime's lifecycle. */
export function ensureSvgSelectorAliases(): void {
  const win: AliasWindow = window;
  if (!win.__hfSvgSelectorAliases) installSvgSelectorAliases(win);
}
