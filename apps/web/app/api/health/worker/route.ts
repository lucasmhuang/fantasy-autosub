import { describeFailure, getLatestWorkerHeartbeat, isDatabaseQueryError } from "@injurysub/db";
import { isWorkerDown } from "@injurysub/domain";
import { NextResponse } from "next/server";
import { getWebDatabaseConnection } from "../../../../lib/server/db";
import { getWebLogger } from "../../../../lib/server/logger";

// The worker's uptime check for an external monitor (O8, OQ22): 200 while its newest beat is
// fresh, 503 once it is 3 minutes old, before any, or when the beats can't be read. Apart from
// /api/health, which gates web's deploys (RS13). Public: the body carries only the beat's time.
export async function GET(): Promise<NextResponse> {
  let lastBeatAt: Date | null;
  try {
    lastBeatAt = (await getLatestWorkerHeartbeat(getWebDatabaseConnection().db))?.beatAt ?? null;
  } catch (error) {
    if (!isDatabaseQueryError(error)) throw error;
    getWebLogger().error("web.health.worker_unread", undefined, { reason: describeFailure(error) });
    return answer(false, null);
  }
  return answer(!isWorkerDown(lastBeatAt, new Date()), lastBeatAt);
}

function answer(ok: boolean, lastBeatAt: Date | null): NextResponse {
  return NextResponse.json(
    { ok, service: "worker", lastBeatAt: lastBeatAt?.toISOString() ?? null },
    { status: ok ? 200 : 503 }
  );
}
