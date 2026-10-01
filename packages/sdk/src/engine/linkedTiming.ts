import { MEDIA_LINK_ATTR, linkScopeOf } from "@hyperframes/core/media-link";
import type { HfId } from "../types.js";
import { escapeHfId, querySelectorAllDeep, resolveScoped } from "./model.js";

interface LinkMember {
  id: HfId;
  link: string;
}

function scopePrefix(id: HfId): string {
  const cut = id.lastIndexOf("/");
  return cut < 0 ? "" : id.slice(0, cut + 1);
}

/** Every element sharing `id`'s link, addressed in `id`'s scope, `id` included. */
function linkGroup(document: Document, id: HfId): LinkMember[] {
  const el = resolveScoped(document, id);
  const link = el?.getAttribute(MEDIA_LINK_ATTR);
  if (!el || !link) return [];
  const scope = linkScopeOf(el);
  const prefix = scopePrefix(id);
  return querySelectorAllDeep(scope ?? document, `[${MEDIA_LINK_ATTR}="${escapeHfId(link)}"]`)
    .filter((member) => linkScopeOf(member) === scope)
    .map((member) => member.getAttribute("data-hf-id"))
    .filter((hfId): hfId is string => Boolean(hfId))
    .map((hfId) => ({ id: `${prefix}${hfId}`, link }));
}

/** Link partners of `ids` that are not themselves in `ids`. */
export function linkedPartnerIds(document: Document, ids: readonly HfId[]): HfId[] {
  const own = new Set(ids);
  const partners = new Set<HfId>();
  for (const id of ids) {
    for (const member of linkGroup(document, id)) {
      if (!own.has(member.id)) partners.add(member.id);
    }
  }
  return [...partners];
}

/** `ids` leaving their link groups: themselves, plus any partner left alone. */
export function idsToUnlink(document: Document, ids: readonly HfId[]): HfId[] {
  const leaving = new Set(ids);
  const result = new Set<HfId>();
  for (const id of ids) {
    const group = linkGroup(document, id);
    if (group.length === 0) continue;
    result.add(id);
    const survivors = group.filter((member) => !leaving.has(member.id));
    if (survivors.length === 1 && survivors[0]) result.add(survivors[0].id);
  }
  return [...result];
}
