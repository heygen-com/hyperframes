import {
  deserializeClipboardPayload,
  serializeClipboardPayload,
  type ClipboardPayload,
} from "./clipboardPayload";

export const INTERNAL_CLIPBOARD_ROUTE = "hyperframes-studio-token:v1";
const DEFAULT_TOKEN_LIFETIME_MS = 5 * 60 * 1_000;

interface InternalClipboardEntry {
  serializedPayload: string;
  sourceProjectId: string;
  expiresAt: number;
}

type InternalClipboardResolution =
  | { kind: "unrecognized" }
  | { kind: "unknown-token" }
  | { kind: "expired-token" }
  | { kind: "foreign-project" }
  | { kind: "resolved"; payload: ClipboardPayload };

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function parseToken(text: string): string | null {
  const prefix = `${INTERNAL_CLIPBOARD_ROUTE}\n`;
  if (!text.startsWith(prefix)) return null;
  const token = text.slice(prefix.length);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : "";
}

export function isInternalClipboardText(text: string): boolean {
  return text.startsWith(INTERNAL_CLIPBOARD_ROUTE);
}

export function createInternalClipboardTokenStore(options?: {
  now?: () => number;
  token?: () => string;
  lifetimeMs?: number;
}) {
  const now = options?.now ?? Date.now;
  const mintToken = options?.token ?? randomToken;
  const lifetimeMs = options?.lifetimeMs ?? DEFAULT_TOKEN_LIFETIME_MS;
  const entries = new Map<string, InternalClipboardEntry>();

  const purgeExpired = (at: number) => {
    for (const [token, entry] of entries) {
      if (entry.expiresAt <= at) entries.delete(token);
    }
  };

  return {
    issue(payload: ClipboardPayload, sourceProjectId: string): string {
      const issuedAt = now();
      purgeExpired(issuedAt);
      const token = mintToken();
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
        throw new Error("Internal clipboard token source returned an invalid token");
      }
      entries.set(token, {
        serializedPayload: serializeClipboardPayload(payload),
        sourceProjectId,
        expiresAt: issuedAt + lifetimeMs,
      });
      return `${INTERNAL_CLIPBOARD_ROUTE}\n${token}`;
    },

    resolve(text: string, targetProjectId: string): InternalClipboardResolution {
      const token = parseToken(text);
      if (token === null) return { kind: "unrecognized" };
      if (token === "") return { kind: "unknown-token" };
      const entry = entries.get(token);
      if (!entry) return { kind: "unknown-token" };
      if (entry.expiresAt <= now()) {
        entries.delete(token);
        return { kind: "expired-token" };
      }
      if (entry.sourceProjectId !== targetProjectId) return { kind: "foreign-project" };
      const payload = deserializeClipboardPayload(entry.serializedPayload);
      if (!payload) throw new Error("Stored internal clipboard payload became invalid");
      return { kind: "resolved", payload };
    },
  };
}
