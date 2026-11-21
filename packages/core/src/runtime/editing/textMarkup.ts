// Text markup: text in inline text tags carrying plain attributes, so no URL and no handler.
export const DATA_ATTRIBUTE = /^data-[a-z0-9_-]+$/;
export const MAX_EDIT_VALUE = 200_000;
const TEXT_TAGS = new Set([
  "span",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "br",
  "sub",
  "sup",
  "small",
]);
const TEXT_ATTRIBUTES = new Set(["class", "id", "style", "title", "lang", "dir"]);

export const holdsOnlyTextMarkup = (root: ParentNode): boolean =>
  Array.from(root.querySelectorAll("*")).every(
    (el) =>
      TEXT_TAGS.has(el.localName) &&
      el
        .getAttributeNames()
        .every((name) => TEXT_ATTRIBUTES.has(name) || DATA_ATTRIBUTE.test(name)),
  );

export const isEditableText = (element: Element): boolean =>
  holdsOnlyTextMarkup(element) && element.innerHTML.length <= MAX_EDIT_VALUE;
