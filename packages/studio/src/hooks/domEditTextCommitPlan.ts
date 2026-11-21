import {
  buildDomEditRichTextPatchOperation,
  buildDomEditTextPatchOperation,
  serializeDomEditTextFields,
  type DomEditTextField,
} from "../components/editor/domEditing";
import type { PatchOperation } from "../utils/sourcePatcher";
import { buildTextFieldChildOperations } from "./domEditTextFieldCommitOps";

interface DomTextCommitPlan {
  usesSerializedTextFields: boolean;
  nextContent: string;
  operations: PatchOperation[];
}

export function buildNextDomTextFields(
  textFields: DomEditTextField[],
  value: string,
  fieldKey?: string,
): DomEditTextField[] {
  if (textFields.length === 0) return [];
  return textFields.map((field) => (field.key === fieldKey ? { ...field, value } : field));
}

const joinsWords = (before: string, after: string) =>
  /\S$/.test(before) && /^[^\s\p{P}]/u.test(after);

export function spacedAround(fields: DomEditTextField[], key: string): DomEditTextField[] {
  const at = fields.findIndex((field) => field.key === key);
  return fields.map((field, index) => {
    const before = fields[index - 1];
    const beside = at >= 0 && (index === at || index === at + 1);
    return beside && before && !field.spaceBefore && joinsWords(before.value, field.value)
      ? { ...field, spaceBefore: " " }
      : field;
  });
}

export function planDomTextCommit(
  originalTextFields: DomEditTextField[],
  nextTextFields: DomEditTextField[],
  plainTextContent: string,
): DomTextCommitPlan {
  const usesSerializedTextFields =
    nextTextFields.length > 1 || nextTextFields.some((field) => field.source === "child");
  const nextContent = usesSerializedTextFields
    ? serializeDomEditTextFields(nextTextFields)
    : plainTextContent;
  const childOperations = usesSerializedTextFields
    ? buildTextFieldChildOperations(originalTextFields, nextTextFields)
    : null;
  // Per-child operations when the layers still line up one-for-one. Structure
  // changes write the element's markup because no stable child address exists.
  const operations =
    childOperations ??
    (usesSerializedTextFields
      ? [buildDomEditRichTextPatchOperation(nextContent)]
      : [buildDomEditTextPatchOperation(nextContent)]);

  return { usesSerializedTextFields, nextContent, operations };
}
