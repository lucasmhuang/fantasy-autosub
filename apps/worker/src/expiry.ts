import { randomUUID } from "node:crypto";
import type { Logger } from "@injurysub/config";
import {
  appendEvent,
  type DatabaseConnection,
  listWaitingRequests,
  type SubRequestRecord,
  transitionRequest,
} from "@injurysub/db";
import { isMatchupWeekOver, transition } from "@injurysub/domain";
import { type EspnClient, EspnError, type MatchupWeek } from "@injurysub/espn";
import { enqueueCommissionerEmail } from "./commissioner-email";

export type WeekSource = Pick<EspnClient, "mode" | "getCurrentWeek">;

type ExpirySweep = { connection: DatabaseConnection; espn: WeekSource; logger: Logger; now: Date };
type SweepAction = "expire" | "end_week";

// Sends waiting requests (for approval or execution) to the commissioner: those whose matchup
// has ended as week_ended, then those past their expiry as expired. Whether a matchup has ended
// takes ESPN's current week, so without ESPN (none mode), or when the read fails, only expiry is
// checked. ESPN is read only when something is waiting.
export async function sweepWaitingRequests(sweep: ExpirySweep): Promise<void> {
  const waiting = await listWaitingRequests(sweep.connection.db);
  if (waiting.length === 0) return;
  const ended = await matchupEndedCheck(sweep);
  for (const request of waiting) {
    const action = actionFor(request, ended, sweep.now);
    if (action !== null) await sendToReview(sweep, request, action);
  }
}

function actionFor(
  request: SubRequestRecord,
  ended: (request: SubRequestRecord) => boolean,
  now: Date
): SweepAction | null {
  if (ended(request)) return "end_week";
  const expired = request.expiresAt !== null && request.expiresAt.getTime() <= now.getTime();
  return expired ? "expire" : null;
}

async function matchupEndedCheck(
  sweep: ExpirySweep
): Promise<(request: SubRequestRecord) => boolean> {
  if (sweep.espn.mode === "none") return () => false;
  try {
    const { meta, week } = await sweep.espn.getCurrentWeek();
    return (request) => hasEnded(request, meta.season, week);
  } catch (error) {
    if (!(error instanceof EspnError)) throw error;
    sweep.logger.warn("worker.expiry.week_unread", { code: error.code });
    return () => false;
  }
}

// A matchup has ended once ESPN's current week is a later one, or, after the season, once
// ESPN's day is past the final week's last day.
function hasEnded(request: SubRequestRecord, season: number, week: MatchupWeek): boolean {
  if (request.season !== season) return request.season < season;
  if (request.matchupPeriodId !== week.matchupPeriodId) {
    return request.matchupPeriodId < week.matchupPeriodId;
  }
  return isMatchupWeekOver(week);
}

// In one transaction at the request's version, so a commissioner acting at the same moment wins
// or loses whole: the status, an event and the commissioner's email.
async function sendToReview(sweep: ExpirySweep, request: SubRequestRecord, action: SweepAction) {
  const next = transition(request, { type: action }, { matchupEnded: true, writeGate: "open" });
  if (!next.ok) return;
  const { now } = sweep;
  await sweep.connection.transaction(async (tx) => {
    const moved = await transitionRequest(tx, {
      requestId: request.requestId,
      fromStatus: request.status,
      version: request.version,
      patch: { status: next.status, reviewReason: next.reviewReason },
      now,
    });
    if (moved === null) return;
    await appendEvent(tx, moved.requestId, {
      eventId: randomUUID(),
      actorType: "system",
      actorUserId: null,
      eventType: action === "expire" ? "expired" : "week_ended",
      payload: {},
      createdAt: now,
    });
    await enqueueCommissionerEmail(tx, moved, now);
  });
}
