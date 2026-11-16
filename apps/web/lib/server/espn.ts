import { loadServerEnv } from "@injurysub/config";
import {
  createInternalReadClient,
  EspnError,
  type InternalReadClient,
  type WorkerSendMode,
} from "@injurysub/espn";
import { getWebLogger } from "./logger";

declare global {
  var __injurysubWebEspn: InternalReadClient | undefined;
}

// The web's ESPN reads, all through the worker (Dec-D1): the web never holds the cookie.
// Tests put their own client in __injurysubWebEspn.
// The bar the worker's send mode calls for: rehearsal while it only records its ESPN writes
// (never), practice while it sends them to its practice copy of ESPN, none while it sends to the
// real league. While its status can't be read (an older worker during a deploy, or none running)
// there is none: a bar is never shown on a guess.
export type WorkerBar = "rehearsal" | "practice" | null;

const BAR_FOR: Record<WorkerSendMode, WorkerBar> = {
  never: "rehearsal",
  practice: "practice",
  live: null,
};

export async function readWorkerBar(): Promise<WorkerBar> {
  try {
    const { sendMode } = await getWebEspn().getWorkerStatus();
    return BAR_FOR[sendMode];
  } catch (error) {
    if (!(error instanceof EspnError)) throw error;
    getWebLogger().warn("web.worker.status_unread", { code: error.code });
    return null;
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
