import { loadServerEnv } from "@injurysub/config";
import { createInternalReadClient, EspnError, type InternalReadClient } from "@injurysub/espn";
import { getWebLogger } from "./logger";

declare global {
  var __injurysubWebEspn: InternalReadClient | undefined;
}

// The web's ESPN reads, all through the worker (Dec-D1): the web never holds the cookie.
// Tests put their own client in __injurysubWebEspn.
// Whether the worker only records its ESPN writes, sending none: its send mode is never. While
// its status can't be read (an older worker during a deploy, or none running) this says no: the
// rehearsal bar is never shown on a guess.
export async function isWorkerRehearsing(): Promise<boolean> {
  try {
    return (await getWebEspn().getWorkerStatus()).sendMode === "never";
  } catch (error) {
    if (!(error instanceof EspnError)) throw error;
    getWebLogger().warn("web.worker.status_unread", { code: error.code });
    return false;
  }
}

export function getWebEspn(): InternalReadClient {
  if (globalThis.__injurysubWebEspn) return globalThis.__injurysubWebEspn;
  const env = loadServerEnv();
  return createInternalReadClient({
    baseUrl: env.WORKER_INTERNAL_URL,
    token: env.WORKER_INTERNAL_TOKEN,
  });
}
