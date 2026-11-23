import { createHash } from "node:crypto";

export function collectElementDom() {
  const excluded = new Set(["SCRIPT", "STYLE", "LINK", "META"]);
  const nodes = [];
  const paths = new Map();
  const siblingGroups = new WeakMap();
  function siblingCount(element, selector) {
    const owner = element.parentElement ?? element;
    let counts = siblingGroups.get(owner);
    if (!counts) {
      counts = new Map();
      siblingGroups.set(owner, counts);
    }
    if (!counts.has(selector)) {
      const siblings = element.parentElement ? [...element.parentElement.children] : [element];
      counts.set(selector, siblings.filter((sibling) => sibling.matches(selector)).length);
    }
    return counts.get(selector);
  }
  const quote = (value) => JSON.stringify(value);
  function path(element) {
    if (paths.has(element)) return paths.get(element);
    const candidates = [];
    if (element.id) candidates.push(`#${CSS.escape(element.id)}`);
    const hfId = element.getAttribute("data-hf-id");
    if (hfId) candidates.push(`[data-hf-id=${quote(hfId)}]`);
    const unique = candidates.find((selector) => document.querySelectorAll(selector).length === 1);
    const parent = element.parentElement;
    const tag = element.localName;
    const position = parent ? [...parent.children].indexOf(element) + 1 : 1;
    const selector =
      unique ??
      (parent ? `${path(parent)} > ${CSS.escape(tag)}:nth-child(${position})` : CSS.escape(tag));
    paths.set(element, selector);
    return selector;
  }
  function visit(element, parent) {
    if (excluded.has(element.tagName)) return;
    const selector = path(element);
    if (
      document.querySelectorAll(selector).length !== 1 ||
      document.querySelector(selector) !== element
    ) {
      throw new Error(`Element map selector does not resolve uniquely: ${selector}`);
    }
    const classes = [...element.classList].sort();
    const tag = element.localName;
    const simple = `${CSS.escape(tag)}${classes.map((value) => `.${CSS.escape(value)}`).join("")}`;
    const siblings = element.parentElement ? [...element.parentElement.children] : [element];
    const index = nodes.length;
    const node = {
      index,
      parent,
      selector,
      tag,
      id: element.id,
      hfId: element.getAttribute("data-hf-id"),
      classes,
      composition: element.getAttribute("data-composition-id"),
      compositionSrc: element.getAttribute("data-composition-src"),
      text: [...element.childNodes]
        .filter((child) => child.nodeType === 3)
        .map((child) => child.textContent)
        .join("")
        .replace(/\s+/g, " ")
        .trim(),
      media: ["img", "video", "audio", "source", "iframe"].includes(tag)
        ? element.getAttribute("src")
        : null,
      relative:
        element.id && document.querySelectorAll(`#${CSS.escape(element.id)}`).length === 1
          ? `#${CSS.escape(element.id)}`
          : siblingCount(element, simple) === 1
            ? simple
            : `${CSS.escape(tag)}:nth-child(${siblings.indexOf(element) + 1})`,
      position: siblings.indexOf(element) + 1,
      groupSelector: simple,
      siblingMatchCount: siblingCount(element, simple),
      children: [],
    };
    nodes.push(node);
    for (const child of element.children) {
      const childIndex = visit(child, index);
      if (childIndex !== undefined) node.children.push(childIndex);
    }
    return index;
  }
  if (document.body) visit(document.body, null);
  return {
    generation: window.__hfLiveInspection?.generation ?? null,
    nodes,
    limitations: {
      canvas: nodes.filter((node) => node.tag === "canvas").length,
      iframes: nodes.filter((node) => node.tag === "iframe").length,
      shadowRoots: [...document.querySelectorAll("*")].filter((node) => node.shadowRoot).length,
    },
  };
}

function signature(node, nodes) {
  return [
    node.tag,
    node.id,
    node.classes,
    node.composition,
    node.compositionSrc,
    node.text,
    node.media,
    node.children.map((index) => signature(nodes[index], nodes)),
  ];
}

function mediaIdentifier(source) {
  if (source.startsWith("data:")) {
    const mime = source.slice(5).split(/[;,]/, 1)[0] || "text/plain";
    const hash = createHash("sha256").update(source).digest("hex").slice(0, 16);
    return `data:${mime}#sha256:${hash}`;
  }
  if (source.startsWith("blob:")) return "blob:runtime";
  return source;
}

function childPlaces(members) {
  const runs = [];
  let start = members[0].position;
  let previous = start;
  for (const member of members.slice(1)) {
    if (member.position === previous + 1) {
      previous = member.position;
      continue;
    }
    runs.push(start === previous ? `${start}` : `${start}-${previous}`);
    start = previous = member.position;
  }
  runs.push(start === previous ? `${start}` : `${start}-${previous}`);
  return runs.join(",");
}

function describe(node, selector, count, places = "") {
  const fields = [selector];
  if (!selector.startsWith(node.tag)) fields.push(node.tag);
  if (count > 1) fields.push(`×${count}${places ? ` @${places}` : ""}`);
  if (node.generated) fields.push("(generated)");
  if (node.id && selector !== `#${node.id}`) fields.push(`id=${JSON.stringify(node.id)}`);
  if (node.classes.length && !selector.includes("."))
    fields.push(`class=${JSON.stringify(node.classes.join(" "))}`);
  if (node.text) fields.push(JSON.stringify(node.text));
  if (node.media) fields.push(`src=${JSON.stringify(mediaIdentifier(node.media))}`);
  if (node.composition) fields.push(`composition=${JSON.stringify(node.composition)}`);
  if (node.compositionSrc) fields.push(`file=${JSON.stringify(node.compositionSrc)}`);
  return fields.join(" ");
}

export function formatElementMap(snapshot, { file = "index.html" } = {}) {
  const { nodes } = snapshot;
  const lines = [`File: ${JSON.stringify(file)}`];
  const entries = [];
  function siblings(indices, depth) {
    const groups = [];
    for (const index of indices) {
      const node = nodes[index];
      const key = JSON.stringify(signature(node, nodes));
      const previous = groups.at(-1);
      if (!node.id && previous?.key === key) previous.indices.push(index);
      else groups.push({ key, indices: [index] });
    }
    for (const group of groups) {
      const members = group.indices.map((index) => nodes[index]);
      const node = members[0];
      const exactGroup = members.length > 1 && node.siblingMatchCount === members.length;
      if (members.length > 1 && !exactGroup) {
        for (const member of members) emit([member], depth);
      } else emit(members, depth);
    }
  }
  function emit(members, depth, repeatedParents = false) {
    const node = members[0];
    const selector = members.length > 1 && !repeatedParents ? node.groupSelector : node.relative;
    const places = members.length > 1 && !repeatedParents ? childPlaces(members) : "";
    lines.push(`${"  ".repeat(depth)}${describe(node, selector, members.length, places)}`);
    entries.push({
      line: lines.length,
      selectors: members.map((member) => member.selector),
      nodeIndices: members.map((member) => member.index),
    });
    if (members.length === 1) {
      siblings(node.children, depth + 1);
      return;
    }
    // Shared child rows retain the corresponding members under every grouped parent.
    for (let position = 0; position < node.children.length; position++) {
      emit(
        members.map((member) => nodes[member.children[position]]),
        depth + 1,
        true,
      );
    }
  }
  siblings(
    nodes.filter((node) => node.parent === null).map((node) => node.index),
    0,
  );
  const { canvas, iframes, shadowRoots } = snapshot.limitations;
  if (canvas || iframes || shadowRoots)
    lines.push(
      `Unmapped contents: canvas=${canvas}, iframe=${iframes}, shadow-root=${shadowRoots}.`,
    );
  const covered = entries.flatMap((entry) => entry.nodeIndices);
  if (covered.length !== nodes.length || new Set(covered).size !== nodes.length)
    throw new Error("Element map coverage mismatch");
  return {
    text: `${lines.join("\n")}\n`,
    entries,
    elementCount: nodes.length,
    coveredCount: covered.length,
  };
}

export async function createElementMap(page, options) {
  return formatElementMap(await page.evaluate(collectElementDom), options);
}
