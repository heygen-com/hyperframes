import type { ShareService } from "../share/service.js";
import { createShareCsrf } from "./shareBoundary.js";

export function shareSessionKey(value: Awaited<ReturnType<ShareService["checkSession"]>>) {
  return JSON.stringify([value.owner, value.heygen, value.heygenApi]);
}

export function createShareSessions(create: () => Promise<ShareService>) {
  const sessions = new Map<string, ReturnType<typeof session>>();
  function session() {
    let service: Promise<ShareService> | null = null;
    return {
      get: () => (service ??= create()),
      reset: () => {
        service = null;
      },
    };
  }
  return {
    open() {
      const token = createShareCsrf().token;
      if (sessions.size >= 128) {
        const oldest = sessions.keys().next().value;
        if (oldest) sessions.delete(oldest);
      }
      sessions.set(token, session());
      return token;
    },
    get: (token: string) => sessions.get(token),
  };
}
