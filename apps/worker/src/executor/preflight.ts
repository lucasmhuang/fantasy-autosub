import { randomUUID } from "node:crypto";
import type { Logger } from "@injurysub/config";
import {
  type DatabaseConnection,
  enqueueEmail,
  findActiveCommissioner,
  getRequestDetail,
  insertSnapshot,
  readLeagueSettings,
  recordEspnAccess,
  type SubRequestRecord,
  type WriteLease,
} from "@injurysub/db";
import {
  acceptedDesignationOf,
  checkPlanStillHolds,
  claimedEditRecord,
  confirmedPlanOf,
  espnAccessStateFor,
  hasMatchupEnded,
  isSameEdit,
  type LineupEdit,
  type LineupMove,
  type ReviewReason,
  resumeStepFor,
  writeGateFor,
} from "@injurysub/domain";
import { buildCredentialsRefusedOutboxEmail } from "@injurysub/email";
import {
  EspnError,
  type EspnErrorCode,
  type EspnReadOnlyClient,
  type EspnWriteClient,
  type LineupRead,
  type TeamLineup,
  type TeamWeekRead,
} from "@injurysub/espn";
import { claimRequest } from "./claim";
import { moveToReview } from "./review";

export type ExecutorContext = {
  connection: DatabaseConnection;
  espn: Pick<
    EspnReadOnlyClient,
    "getTeamWeek" | "getLineup" | "getTeamDay" | "getCurrentWeek" | "checkLeagueRules"
  >;
  // Sends the ESPN writes, or records them while sending is off; null stops a pass at the claim.
  write: EspnWriteClient | null;
  holder: string;
  // The pass's start, for its checks and the claim.
  now: Date;
  // The time of each record after the claim; tests step it, so no two of a request's events
  // share a time and list in either order.
  clock: () => Date;
  // The pause between readback rounds.
  sleep: (ms: number) => Promise<void>;
  logger: Logger;
};

type PreflightContext = ExecutorContext & { lease: WriteLease };

// A step that writes to ESPN: it holds the lease, and the worker has a write client.
export type WriteStepContext = ExecutorContext & { lease: WriteLease; write: EspnWriteClient };

export type PreflightOutcome =
  | {
      kind: "claimed";
      resumeAt: "lineup";
      request: SubRequestRecord;
      edit: LineupEdit;
      teamWeek: TeamWeekRead;
    }
  | { kind: "claimed"; resumeAt: "adjustment"; request: SubRequestRecord }
  | { kind: "sent_to_review"; reason: ReviewReason }
  | { kind: "blocked"; code: EspnErrorCode }
  | { kind: "changed"; what: EspnChange }
  | { kind: "lost" };

// What moved on ESPN between preflight's read and the read just before the claim.
type EspnChange = "day" | "week" | "edit";

// Checks a queued request against the league's settings and ESPN now, before anything is sent,
// with the request still queued: the allowlist (gate 2), its expiry, then a fresh read of the
// team. A request it can't carry out goes to the commissioner; one ESPN can't be read for stays
// queued at its version, so a manager or the commissioner can still act on it. Only a request
// whose checks pass is claimed.
export async function preflightRequest(
  context: PreflightContext,
  request: SubRequestRecord
): Promise<PreflightOutcome> {
  const settings = await readLeagueSettings(context.connection.db);
  const gate = writeGateFor(settings.writeAllowlist, request.teamId);
  if (gate !== "open") return sendToReview(context, request, gate, {});
  if (request.expiresAt !== null && request.expiresAt.getTime() <= context.now.getTime()) {
    return sendToReview(context, request, "expired", {});
  }
  // A held adjustment re-approved after its lineup was verified: the adjustment step re-runs its
  // own checks, and the swap is never checked as if it were still to be made (AC1-1).
  if (resumeStepFor(request) === "adjustment") {
    const claimed = await claimRequest(context, request, { resumeAt: "adjustment" });
    return claimed === null
      ? { kind: "lost" }
      : { kind: "claimed", resumeAt: "adjustment", request: claimed };
  }
  const read = await readEspn(context, () => context.espn.getTeamWeek(request.teamId));
  if ("code" in read) return { kind: "blocked", code: read.code };
  return checkAndClaim(context, request, read.value);
}

// Reads ESPN, recording what the read says about ESPN access for the whole league: the pages show
// waiting and in-progress requests as held up while ESPN isn't working (O4, O6).
export async function readEspn<T>(
  context: ExecutorContext,
  read: () => Promise<T>
): Promise<{ value: T } | { code: EspnErrorCode }> {
  try {
    const value = await read();
    await recordEspnAccess(context.connection.db, {
      state: espnAccessStateFor(null),
      code: null,
      checkedAt: context.now,
    });
    return { value };
  } catch (error) {
    if (!(error instanceof EspnError)) throw error;
    await recordRefusal(context, error.code);
    return { code: error.code };
  }
}

// A refused cookie emails the commissioner once, when the refusal begins (O3).
async function recordRefusal(context: ExecutorContext, code: EspnErrorCode): Promise<void> {
  const state = espnAccessStateFor(code);
  await context.connection.transaction(async (tx) => {
    const { access, startedNow } = await recordEspnAccess(tx, {
      state,
      code,
      checkedAt: context.now,
    });
    if (!startedNow || state !== "credentials_rejected") return;
    const commissioner = await findActiveCommissioner(tx);
    if (commissioner === null) return;
    const email = buildCredentialsRefusedOutboxEmail({
      to: commissioner.email,
      since: access.since,
    });
    await enqueueEmail(tx, { emailId: randomUUID(), ...email, createdAt: context.now });
  });
  context.logger.warn("worker.executor.espn_unread", { code });
}

async function checkAndClaim(
  context: PreflightContext,
  request: SubRequestRecord,
  teamWeek: TeamWeekRead
): Promise<PreflightOutcome> {
  const espnDay = teamWeek.week.todayScoringPeriodId;
  await insertSnapshot(context.connection.db, request.requestId, "preflight", {
    snapshotId: randomUUID(),
    espnDay,
    takenAt: context.now,
    payload: { lineup: teamWeek.lineup, matchup: teamWeek.matchup },
  });
  // The sweep catches an ended week within a minute; this catches it between sweeps, so an edit
  // never goes to the week after the request's (X19).
  if (hasMatchupEnded(request, { season: teamWeek.meta.season, week: teamWeek.week })) {
    return sendToReview(context, request, "week_ended", {});
  }
  const check = checkPlanStillHolds({
    lineup: teamWeek.lineup,
    injuredPlayerId: request.injuredPlayerId,
    replacementPlayerId: request.replacementPlayerId,
    acceptedDesignation: acceptedDesignationOf(request),
    currentDesignation: designationOf(teamWeek.lineup, request.injuredPlayerId),
  });
  if (!check.ok) return sendToReview(context, request, "stale", { detail: check.detail });
  // The edit that fits now is the one sent, even when it differs from the one confirmed; the
  // claim keeps both then (Dec-D29b).
  const { edit } = check;
  const unchanged = await confirmUnchanged(context, request, edit, espnDay);
  if (unchanged !== null) return unchanged;
  const confirmed = await confirmedPlanFor(context, request.requestId);
  const found = { resumeAt: "lineup", espnDay, ...claimedEditRecord(edit, confirmed) };
  const claimed = await claimRequest(context, request, found);
  if (claimed === null) return { kind: "lost" };
  return { kind: "claimed", resumeAt: "lineup", request: claimed, edit, teamWeek };
}

// ESPN's lineup read again just before the claim, which the send follows at once: the claim goes
// ahead only while ESPN's day, the request's week and the edit are as preflight found them, so
// the body never names a day that has just ended (X13). Otherwise nothing is recorded and the
// request stays queued at its version; the next pass redoes the whole preflight. Null means
// unchanged.
async function confirmUnchanged(
  context: PreflightContext,
  request: SubRequestRecord,
  edit: LineupEdit,
  espnDay: number
): Promise<PreflightOutcome | null> {
  const read = await readEspn(context, () => context.espn.getLineup(request.teamId));
  if ("code" in read) return { kind: "blocked", code: read.code };
  const what = changeSincePreflight(request, edit, espnDay, read.value);
  if (what === null) return null;
  context.logger.info("worker.executor.espn_moved", { requestId: request.requestId, what });
  return { kind: "changed", what };
}

function changeSincePreflight(
  request: SubRequestRecord,
  edit: LineupEdit,
  espnDay: number,
  { meta, team }: LineupRead
): EspnChange | null {
  if (meta.scoringPeriodId !== espnDay) return "day";
  if (meta.matchupPeriodId !== request.matchupPeriodId) return "week";
  const check = checkPlanStillHolds({
    lineup: team,
    injuredPlayerId: request.injuredPlayerId,
    replacementPlayerId: request.replacementPlayerId,
    acceptedDesignation: acceptedDesignationOf(request),
    currentDesignation: designationOf(team, request.injuredPlayerId),
  });
  return check.ok && isSameEdit(check.edit.items, edit.items) ? null : "edit";
}

// The edit Confirm recorded with the request, or null for a request filed before plans were kept.
async function confirmedPlanFor(
  context: PreflightContext,
  requestId: string
): Promise<LineupMove[] | null> {
  const detail = await getRequestDetail(context.connection.db, requestId);
  const filed = detail?.snapshots.find((snapshot) => snapshot.phase === "request");
  return confirmedPlanOf(filed?.payload);
}

// The player's designation on ESPN now; a player no longer on the roster has none.
function designationOf(lineup: TeamLineup, playerId: number): string {
  const slots = [...lineup.starters, ...lineup.bench, ...lineup.injuredReserve];
  return (
    slots.find(({ player }) => player?.playerId === playerId)?.player?.designation.status ?? ""
  );
}

// At the version preflight read, before anything was sent: the lineup is as it was.
function sendToReview(
  context: PreflightContext,
  request: SubRequestRecord,
  reason: ReviewReason,
  found: Record<string, unknown>
): Promise<PreflightOutcome> {
  return moveToReview(context, request, { reason, found, patch: {}, at: context.now });
}
