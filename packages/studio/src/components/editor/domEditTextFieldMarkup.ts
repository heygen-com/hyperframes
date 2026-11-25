import { escapeHtmlText } from "./domEditingLayers";
import type { DomEditTextField } from "./domEditingTypes";

function serializeTextFieldStyle(field: DomEditTextField): string {
  const entries = Object.entries(field.inlineStyles).filter(([, value]) => Boolean(value));
  if (entries.length === 0) return "";
  return entries.map(([key, value]) => `${key}: ${value}`).join("; ");
}

export function serializeDomEditTextFields(fields: DomEditTextField[]): string {
  return fields
    .filter((field) => field.source === "child" || field.source === "text-node")
    .map((field) => (field.spaceBefore ?? "") + serializeTextField(field))
    .join("");
}

function serializeTextField(field: DomEditTextField): string {
  if (field.source === "text-node") return escapeHtmlText(field.value);
  const attrs = [
    ...field.attributes.filter((attribute) => attribute.name !== "data-hf-text-key"),
    { name: "data-hf-text-key", value: field.key },
  ]
    .map((attribute) => ` ${attribute.name}="${attribute.value.replace(/"/g, "&quot;")}"`)
    .join("");
  const style = serializeTextFieldStyle(field);
  const styleAttr = style ? ` style="${style.replace(/"/g, "&quot;")}"` : "";
  return `<${field.tagName}${attrs}${styleAttr}>${escapeHtmlText(field.value)}</${field.tagName}>`;
}
