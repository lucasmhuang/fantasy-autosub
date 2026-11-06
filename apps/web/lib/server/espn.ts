import { loadServerEnv } from "@injurysub/config";
import { createInternalReadClient, type InternalReadClient } from "@injurysub/espn";

declare global {
  var __injurysubWebEspn: InternalReadClient | undefined;
}

// The web's ESPN reads, all through the worker (Dec-D1): the web never holds the cookie.
// Tests put their own client in __injurysubWebEspn.
export function getWebEspn(): InternalReadClient {
  if (globalThis.__injurysubWebEspn) return globalThis.__injurysubWebEspn;
  const env = loadServerEnv();
  return createInternalReadClient({
    baseUrl: env.WORKER_INTERNAL_URL,
    token: env.WORKER_INTERNAL_TOKEN,
  });
}
