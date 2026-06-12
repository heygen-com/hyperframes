import { findUnsafeDomPatchValues } from "@hyperframes/core/studio-api/finite-mutation";
import type { DomEditSelection } from "../components/editor/domEditingTypes";

export const PROPERTY_DEFAULTS: Record<string, number> = {
  opacity: 1,
  x: 0,
  y: 0,
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  width: 100,
  height: 100,
};

export function ensureElementAddressable(selection: DomEditSelection): {
  selector: string;
  autoId?: string;
} {
  if (selection.id) return { selector: `#${selection.id}` };
  if (selection.selector) return { selector: selection.selector };

  const el = selection.element;
  const doc = el.ownerDocument;
  const tag = el.tagName.toLowerCase();
  let id = tag;
  let n = 1;
  while (doc.getElementById(id)) {
    n += 1;
    id = `${tag}-${n}`;
  }
  el.setAttribute("id", id);
  return { selector: `#${id}`, autoId: id };
}

export class GsapMutationHttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly responseBody: unknown,
  ) {
    super(formatGsapMutationHttpErrorMessage(statusCode, responseBody));
    this.name = "GsapMutationHttpError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function readJsonResponseBody(res: Response): Promise<unknown> {
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return await res.text().catch(() => null);
  }
  return await res.json().catch(() => null);
}

function formatGsapMutationHttpErrorMessage(statusCode: number, body: unknown): string {
  if (isRecord(body) && typeof body.error === "string") {
    return body.error;
  }
  return `GSAP mutation failed with status ${statusCode}`;
}

export function formatGsapMutationRejectionToast(error: GsapMutationHttpError): string {
  const body = error.responseBody;
  if (isRecord(body)) {
    const fields = Array.isArray(body.fields)
      ? body.fields.filter((field): field is string => typeof field === "string")
      : [];
    const suffix = fields.length > 0 ? ` (${fields.join(", ")})` : "";
    return `Couldn't save animation: ${formatGsapMutationHttpErrorMessage(
      error.statusCode,
      body,
    )}${suffix}`;
  }
  return `Couldn't save animation: ${error.message}`;
}

interface AssignAutoIdParams {
  projectId: string;
  targetPath: string;
  selection: DomEditSelection;
  autoId: string;
  showToast?: (message: string, tone?: "error" | "info") => void;
}

export async function assignGsapTargetAutoIdIfNeeded({
  projectId,
  targetPath,
  selection,
  autoId,
  showToast,
}: AssignAutoIdParams): Promise<boolean> {
  const patchBody = {
    target: {
      id: selection.id,
      hfId: selection.hfId,
      selector: selection.selector,
      selectorIndex: selection.selectorIndex,
    },
    operations: [{ type: "html-attribute", property: "id", value: autoId }],
  };
  const unsafePatchFields = findUnsafeDomPatchValues(patchBody);
  if (unsafePatchFields.length > 0) {
    showToast?.("Couldn't assign element id because the patch contains invalid values", "error");
    return false;
  }
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/file-mutations/patch-element/${encodeURIComponent(targetPath)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patchBody),
    },
  );
  if (!res.ok) {
    showToast?.(
      formatGsapMutationRejectionToast(
        new GsapMutationHttpError(res.status, await readJsonResponseBody(res)),
      ),
      "error",
    );
    return false;
  }
  const data = (await res.json()) as { changed?: boolean };
  return data.changed === true;
}
