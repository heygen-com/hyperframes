// @ts-check
import { DOMParser } from "linkedom";
import { readCompositionVariables } from "@hyperframes/parsers/composition";

/** @param {unknown} value @param {"url"|"source"} key */
function assetValue(value, key) {
  if (typeof value === "string") return key === "url" ? value : null;
  if (!value || typeof value !== "object") return null;
  const path = Reflect.get(value, key);
  return typeof path === "string" ? path : null;
}

/** @param {string | null} raw @returns {Record<string,unknown>} */
export function overrides(raw) {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

/** @param {Element} scope */
function scopeValues(scope) {
  const { declarations } = readCompositionVariables(
    scope.getAttribute("data-composition-variables"),
  );
  const values = new Map(declarations.map((v) => [v.id, /** @type {unknown} */ (v.default)]));
  for (const [key, value] of Object.entries(overrides(scope.getAttribute("data-variable-values"))))
    values.set(key, value);
  return { declarations, values };
}

const declaredScope = "[data-composition-variables],[data-variable-values]";
const boundMedia = "img[data-var-src],video[data-var-src],audio[data-var-src],source[data-var-src]";
const parseDocument = (/** @type {string} */ source) =>
  new DOMParser().parseFromString(source, "text/html");

/** @param {ReturnType<typeof parseDocument>} fragment @param {(url:string)=>void} add */
function declaredAssets(fragment, add) {
  for (const scope of fragment.querySelectorAll(declaredScope)) {
    const { declarations, values } = scopeValues(scope);
    for (const v of declarations) {
      if (v.type !== "image" && v.type !== "font") continue;
      const url = assetValue(values.get(v.id), v.type === "image" ? "url" : "source");
      if (url) add(url);
    }
  }
}

/** @param {ReturnType<typeof parseDocument>} fragment @param {(url:string)=>void} add */
function boundAssets(fragment, add) {
  const cache = new Map();
  for (const el of fragment.querySelectorAll(boundMedia)) {
    const scope = el.closest(declaredScope);
    if (!scope) continue;
    if (!cache.has(scope)) cache.set(scope, scopeValues(scope).values);
    const url = assetValue(cache.get(scope).get(el.getAttribute("data-var-src")?.trim()), "url");
    if (url) add(url);
  }
}

/** @typedef {"url"|"source"} AssetKey
 * @typedef {{first:string|null, scopes: Map<string, Map<string,AssetKey>>}} MediaSlots */

/** @param {Element} element @param {Element|null} scope @param {Map<string,AssetKey>} keys */
function recordAssetKeys(element, scope, keys) {
  const bound = element.matches(boundMedia) && element.getAttribute("data-var-src")?.trim();
  if (bound) keys.set(bound, "url");
  if (element !== scope && element.tagName.toLowerCase() !== "html") return;
  const { declarations } = readCompositionVariables(
    element.getAttribute("data-composition-variables"),
  );
  for (const declaration of declarations) {
    if (declaration.type === "image") keys.set(declaration.id, "url");
    if (declaration.type === "font") keys.set(declaration.id, "source");
  }
}

/** A host binds values to the child document's declarations and its mounted composition scope.
 * A text value names an asset only when the child binds it to a media element.
 * @param {ReturnType<typeof parseDocument>} fragment @param {MediaSlots} slots */
function mediaSlots(fragment, slots) {
  slots.first ??=
    fragment.querySelector("[data-composition-id]")?.getAttribute("data-composition-id") ?? null;
  for (const element of fragment.querySelectorAll("[data-composition-variables]," + boundMedia)) {
    const scope = element.closest("[data-composition-id]");
    const id = scope?.getAttribute("data-composition-id") ?? "";
    let keys = slots.scopes.get(id);
    if (!keys) slots.scopes.set(id, (keys = new Map()));
    recordAssetKeys(element, scope, keys);
  }
}

/** @param {MediaSlots | undefined} slots @param {string} id @param {string} key @param {unknown} value */
export function mountedAsset(slots, id, key, value) {
  const scoped = slots?.scopes.get(id || slots.first || "");
  const kind = scoped?.get(key) ?? slots?.scopes.get("")?.get(key);
  return kind ? assetValue(value, kind) : null;
}

/** @param {string} source @param {(url:string)=>void} add @returns {MediaSlots|undefined} */
export function variableReferences(source, add) {
  if (!/data-(?:var-src|composition-variables|variable-values)\s*=/i.test(source)) return;
  /** @type {MediaSlots} */
  const slots = { first: null, scopes: new Map() };
  const pending = [parseDocument(source)];
  for (let fragment = pending.pop(); fragment; fragment = pending.pop()) {
    for (const template of fragment.querySelectorAll("template")) pending.push(template.content);
    declaredAssets(fragment, add);
    boundAssets(fragment, add);
    mediaSlots(fragment, slots);
  }
  return slots;
}
