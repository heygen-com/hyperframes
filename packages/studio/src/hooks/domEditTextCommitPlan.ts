import {
  buildDomEditRichTextPatchOperation,
  buildDomEditTextPatchOperation,
  serializeDomEditTextFields,
  type DomEditTextField,
} from "../components/editor/domEditing";
import type { PatchOperation } from "../utils/sourcePatcher";
import { buildTextFieldChildOperations } from "./domEditTextFieldCommitOps";
import { respaceAddedFields } from "../components/editor/textFieldSpacing";

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

export const usesSerializedTextFields = (fields: DomEditTextField[]) =>
  fields.length > 1 || fields.some((field) => field.source === "child");

export function planDomTextCommit(
  originalTextFields: DomEditTextField[],
  nextTextFields: DomEditTextField[],
  plainTextContent: string,
): DomTextCommitPlan {
  const serialized = usesSerializedTextFields(nextTextFields);
  const markup = serialized ? serializeDomEditTextFields(nextTextFields) : plainTextContent;
  const nextContent = serialized ? respaceAddedFields(markup) : markup;
  const childOperations =
    serialized && nextContent === markup
      ? buildTextFieldChildOperations(originalTextFields, nextTextFields)
      : null;
  // Per-child operations when the layers still line up one-for-one. Structure
  // changes write the element's markup because no stable child address exists.
  const operations =
    childOperations ??
    (serialized
      ? [buildDomEditRichTextPatchOperation(nextContent)]
      : [buildDomEditTextPatchOperation(nextContent)]);

  return { usesSerializedTextFields: serialized, nextContent, operations };
}
