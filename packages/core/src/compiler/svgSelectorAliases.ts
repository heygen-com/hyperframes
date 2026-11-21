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
  lookups: Map<string, SortedKeys | Map<string, number[]>>;
}

interface SortedKeys {
  keys: string[];
  at: number[];
}

interface AliasIndex {
  everyRecordedId: Set<string>;
  renamedIdAlternatives: Map<string, string>;
  unprefixed: Map<string, AttributeAliases>;
  anyNamespace: Map<string, AttributeAliases>;
  inNamespace: Map<string, AttributeAliases>;
}

const namespacedKey = (localName: string, uri: string | null) =>
  JSON.stringify([lower(localName), uri]);

// A scope's alias list is read once and then only passed around, so its index is built once per list.
const aliasIndexes = new WeakMap<readonly SvgReferenceAlias[], AliasIndex>();

function addTo(map: Map<string, AttributeAliases>, key: string, alias: SvgReferenceAlias): void {
  let entry = map.get(key);
  if (!entry) map.set(key, (entry = { all: [], lookups: new Map() }));
  entry.all.push(alias);
}

function indexByAttribute(index: AliasIndex, alias: SvgReferenceAlias): void {
  const { namespaceURI } = alias;
  if (namespaceURI === null) addTo(index.unprefixed, lower(alias.name), alias);
  addTo(index.anyNamespace, lower(alias.localName), alias);
  addTo(index.inNamespace, namespacedKey(alias.localName, namespaceURI), alias);
}

function aliasIndex(references: readonly SvgReferenceAlias[]): AliasIndex {
  let index = aliasIndexes.get(references);
  if (index) return index;
  index = {
    everyRecordedId: new Set(),
    renamedIdAlternatives: new Map(),
    unprefixed: new Map(),
    anyNamespace: new Map(),
    inNamespace: new Map(),
  };
  const ids = new Map<string, Set<string>>();
  // Every element that references one symbol records the same alias; one copy is enough.
  const seen = new Set<string>();
  for (const alias of references) {
    if (alias.name === "id") index.everyRecordedId.add(alias.before);
    if (alias.before === alias.after) continue;
    const key = JSON.stringify([
      alias.name,
      alias.localName,
      alias.namespaceURI,
      alias.before,
      alias.after,
    ]);
    if (seen.has(key)) continue;
    seen.add(key);
    indexByAttribute(index, alias);
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

type ParsedAttribute = NonNullable<ReturnType<typeof tokens.parseAttributeSelector>>;
type Namespaces = ReadonlyMap<string, string | null>;

type Fold = (text: string) => string;
const same: Fold = (text) => text;
const reversed: Fold = (text) => text.split("").reverse().join("");
const whitespace = /[ \t\r\n\f]+/;

function sortedKeys(entry: AttributeAliases, id: string, key: Fold): SortedKeys {
  let keys = entry.lookups.get(id) as SortedKeys | undefined;
  if (keys) return keys;
  const order = entry.all.map((alias, at) => [key(alias.before), at] as const);
  order.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  keys = { keys: order.map(([text]) => text), at: order.map(([, at]) => at) };
  entry.lookups.set(id, keys);
  return keys;
}

function keysFrom({ keys, at }: SortedKeys, prefix: string, exact = false): number[] {
  let low = 0;
  for (let high = keys.length; low < high; ) {
    const mid = (low + high) >>> 1;
    if (keys[mid]! < prefix) low = mid + 1;
    else high = mid;
  }
  const found: number[] = [];
  for (
    let i = low;
    i < keys.length && (exact ? keys[i] === prefix : keys[i]!.startsWith(prefix));
    i++
  )
    found.push(at[i]!);
  return found;
}

function withToken(entry: AttributeAliases, id: string, fold: Fold, token: string): number[] {
  let tokens = entry.lookups.get(id) as Map<string, number[]> | undefined;
  if (!tokens) {
    tokens = new Map();
    for (const [at, alias] of entry.all.entries())
      for (const each of new Set(fold(alias.before).split(whitespace))) {
        const list = tokens.get(each);
        if (list) list.push(at);
        else tokens.set(each, [at]);
      }
    entry.lookups.set(id, tokens);
  }
  return tokens.get(token) ?? [];
}

interface Lookup {
  entry: AttributeAliases;
  value: string;
  fold: Fold;
  id: (lookup: string) => string;
  chargeScan?: (chars: number) => void;
}

const starts = ({ entry, fold, id }: Lookup) => sortedKeys(entry, id("^="), fold);

// Each lookup but `*=` costs only its matches, which are charged as alternatives; `*=` charges its scan.
const lookups: Record<ParsedAttribute["operator"], (lookup: Lookup) => number[]> = {
  "=": (lookup) => keysFrom(starts(lookup), lookup.value, true),
  "^=": (lookup) => keysFrom(starts(lookup), lookup.value),
  "$=": ({ entry, value, fold, id }) =>
    keysFrom(
      sortedKeys(entry, id("$="), (text) => reversed(fold(text))),
      reversed(value),
    ),
  "|=": (lookup) => [
    ...keysFrom(starts(lookup), lookup.value, true),
    ...keysFrom(starts(lookup), `${lookup.value}-`),
  ],
  "~=": ({ entry, value, fold, id }) => withToken(entry, id("~="), fold, value),
  "*=": ({ entry, value, fold, chargeScan }) =>
    entry.all.flatMap((alias, at) => {
      chargeScan?.(alias.before.length);
      return fold(alias.before).includes(value) ? [at] : [];
    }),
};

function positionsFor(
  entry: AttributeAliases,
  { operator, value, flag }: ParsedAttribute,
  chargeScan?: (chars: number) => void,
): number[] {
  if (!value && operator !== "=" && operator !== "|=") return [];
  const folds = flag?.toLowerCase() === "i";
  const fold = folds ? lower : same;
  const id = (lookup: string) => (folds ? `${lookup} i` : lookup);
  return lookups[operator]({ entry, value: fold(value), fold, id, chargeScan });
}

function entryFor(
  index: AliasIndex,
  { name, namespace }: ParsedAttribute,
  namespaces?: Namespaces,
): AttributeAliases | undefined {
  if (namespace.kind === "none") return index.unprefixed.get(lower(name));
  if (namespace.kind === "any") return index.anyNamespace.get(lower(name));
  const uri = namespaces!.get(namespace.prefix);
  return uri === undefined ? undefined : index.inNamespace.get(namespacedKey(name, uri));
}

function aliasesFor(
  index: AliasIndex,
  parsed: ParsedAttribute,
  namespaces?: Namespaces,
  chargeScan?: (chars: number) => void,
) {
  const entry = entryFor(index, parsed, namespaces);
  if (!entry) return [];
  return positionsFor(entry, parsed, chargeScan)
    .sort((a, b) => a - b)
    .map((at) => entry.all[at]!);
}

/**
 * With `namespaces` (a live sheet's bindings) only prefixed attribute selectors are
 * rewritten; without it they stay as authored and everything else is rewritten.
 */
export function rewriteSvgSelectors(
  selector: string,
  ids: readonly IdSelectorAlias[],
  references: readonly SvgReferenceAlias[],
  namespaces?: Namespaces,
  charge?: (bytes: number) => void,
  chargeScan?: (chars: number) => void,
): string {
  const index = aliasIndex(references);
  const rewriteAttribute = (predicate: string): string => {
    const parsed = tokens.parseAttributeSelector(predicate);
    if (!parsed || (parsed.namespace.kind === "named") !== (namespaces !== undefined)) {
      return predicate;
    }
    const { rawName, flag } = parsed;
    const alternatives = new Set([predicate]);
    for (const alias of aliasesFor(index, parsed, namespaces, chargeScan)) {
      const alternative = `[${rawName}="${tokens.escapeCssAttributeValue(alias.after)}"${flag ? ` ${flag}` : ""}]`;
      if (alternatives.has(alternative)) continue;
      charge?.(alternative.length + (alternatives.size === 1 ? ":is(, )".length : ", ".length));
      alternatives.add(alternative);
    }
    return alternatives.size === 1 ? predicate : `:is(${[...alternatives].join(", ")})`;
  };
  if (namespaces) return tokens.replaceSelectorAttributeTokens(selector, rewriteAttribute);
  const replacements = new Map(ids.map(({ id, replacement }) => [id, replacement]));
  const namedIds = tokens
    .selectorIdTokens(selector)
    .filter((id) => replacements.has(id) || index.renamedIdAlternatives.has(id));
  const rewrittenIds = tokens.replaceSelectorIdTokens(selector, namedIds, (id, token) => {
    const replacement = replacements.get(id) ?? index.renamedIdAlternatives.get(id)!;
    charge?.(replacement.length - token.length);
    return replacement;
  });
  return tokens.replaceSelectorAttributeTokens(rewrittenIds, rewriteAttribute);
}

export function dropAuthoredSvgReferenceAliases(root: ParentNode): boolean {
  let dropped = false;
  const pending: ParentNode[] = [root];
  for (let node = pending.pop(); node; node = pending.pop()) {
    for (const el of Array.from(node.children)) {
      if (el.hasAttribute(SVG_REFERENCE_ALIASES_ATTR)) {
        el.removeAttribute(SVG_REFERENCE_ALIASES_ATTR);
        dropped = true;
      }
      const html = el.localName === "template" && !el.firstElementChild && "content" in el;
      pending.push(html ? (el as HTMLTemplateElement).content : el);
    }
  }
  return dropped;
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
