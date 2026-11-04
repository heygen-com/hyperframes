import { resolveCloudAuthHeaders, resolveCloudBaseUrl } from "../cloud/auth.js";
import { Fix } from "../measure/media.js";
import { fetchExplained, NetworkFailure } from "../utils/networkFailure.js";

export interface AvatarLook {
  /** The look id: `media-use generate --type avatar --avatar <avatar_id>`. */
  avatar_id: string;
  name: string;
  avatar_type?: string;
  group_id?: string;
  gender?: string;
  status?: string;
  default_voice_id?: string;
  preview_image_url?: string;
}

const PAGE_LIMIT = 50;
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

function toLook(item: unknown): AvatarLook | null {
  if (!isRecord(item) || typeof item.id !== "string" || typeof item.name !== "string") return null;
  const look: AvatarLook = { avatar_id: item.id, name: item.name };
  const optional = {
    avatar_type: text(item.avatar_type),
    group_id: text(item.group_id),
    gender: text(item.gender),
    status: text(item.status),
    default_voice_id: text(item.default_voice_id),
    preview_image_url: text(item.preview_image_url),
  };
  for (const [key, value] of Object.entries(optional))
    if (value) Object.assign(look, { [key]: value });
  return look;
}

/** `{data, has_more, next_token}`, whether or not HeyGen wraps it in a `data` envelope. */
function pageOf(body: unknown): { items: unknown[]; next: string | undefined } | null {
  const page = isRecord(body) && isRecord(body.data) && !("has_more" in body) ? body.data : body;
  if (!isRecord(page) || !Array.isArray(page.data)) return null;
  return { items: page.data, next: page.has_more === true ? text(page.next_token) : undefined };
}

async function fetchPage(auth: Record<string, string>, limit: number, token?: string) {
  const url = new URL("/v3/avatars/looks", resolveCloudBaseUrl());
  url.searchParams.set("ownership", "private");
  url.searchParams.set("limit", String(limit));
  if (token) url.searchParams.set("token", token);
  const res = await fetchExplained(url.toString(), {
    headers: { ...auth, accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  }).catch((err: unknown) => {
    if (err instanceof NetworkFailure) throw new Fix(err.message, err.hint);
    throw new Fix(
      `no answer from HeyGen for its avatars (${err instanceof Error ? err.message : String(err)})`,
      "run the same command again",
    );
  });
  if (!res.ok)
    throw new Fix(
      `HeyGen ${res.status} listing its avatars`,
      res.status === 401 || res.status === 403
        ? "npx hyperframes auth login"
        : "run the same command again",
    );
  const page = pageOf(await res.json().catch(() => null));
  if (!page)
    throw new Fix("HeyGen answered its avatars with no list", "run the same command again");
  return page;
}

/** The avatar looks on the HyperFrames account that makes the film, in the order HeyGen lists them. */
export async function ownAvatarLooks(limit: number): Promise<AvatarLook[]> {
  const auth = await resolveCloudAuthHeaders().catch((err: unknown) => {
    if (err instanceof NetworkFailure) throw new Fix(err.message, err.hint);
    throw new Fix("no HeyGen sign-in on this machine", "npx hyperframes auth login");
  });
  const looks: AvatarLook[] = [];
  let token: string | undefined;
  do {
    const page = await fetchPage(auth, Math.min(PAGE_LIMIT, limit - looks.length), token);
    for (const item of page.items) {
      const look = toLook(item);
      if (look && looks.length < limit) looks.push(look);
    }
    token = page.next;
  } while (token && looks.length < limit);
  return looks;
}
