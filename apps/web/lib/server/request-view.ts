import {
  type AlertEmailState,
  type DatabaseExecutor,
  describeFailure,
  findRequestAlertEmailState,
  findTeamEarlierInFlightRequest,
  getEspnAccess,
  getLatestWorkerHeartbeat,
  getRequestDetail,
  hasEarlierInFlightRequestElsewhere,
  isDatabaseQueryError,
  listTeamRequests,
  type RequestDetail,
  type SubRequestRecord,
} from "@injurysub/db";
import {
  type AdjustmentLine,
  computedLinesOf,
  type EspnAccessState,
  espnBlockFor,
  isRequestEventType,
  isWorkerDown,
  type LineupMove,
  type RequestActorType,
  type RequestEventType,
  type ReviewReason,
  requestAmountTenths,
  type SubRequestStatus,
  sentEditOf,
  transition,
} from "@injurysub/domain";
import { z } from "zod";
import { getWebDatabaseConnection } from "./db";
import { getWebLogger } from "./logger";

export type HistoryEntry = {
  requestId: string;
  status: SubRequestStatus;
  injuredPlayerId: number;
  injuredName: string;
  replacementPlayerId: number;
  replacementName: string;
  filedAt: Date;
  matchupPeriodId: number;
  amountTenths: number | null;
};

export type TeamHistory = { status: "unavailable" } | { status: "found"; requests: HistoryEntry[] };

export type BreakdownLine = {
  day: number;
  name: string;
  tenths: number;
  why: AdjustmentLine["why"];
};

export type RequestView =
  | { status: "not_found" | "unavailable" | "proving" }
  | {
      status: "found";
      request: {
        requestId: string;
        status: SubRequestStatus;
        reviewReason: ReviewReason | null;
        refusalReason: string | null;
        injuredPlayerId: number;
        injuredName: string;
        injuredSlot: string;
        replacementPlayerId: number;
        replacementName: string;
        filedAt: Date;
        requestMoment: Date;
        // ESPN's day at the request moment.
        requestDay: number;
        matchupPeriodId: number;
        // The final amount once settled, else the commissioner's override, else the projection.
        adjustmentTenths: number | null;
        adjustmentIsFinal: boolean;
        effectiveDay: number | null;
        // Its latest run sent nothing to ESPN, by the request's own record (S11).
        rehearsal: boolean;
      };
      breakdown: BreakdownLine[];
      commissionerReason: string | null;
      canWithdraw: boolean;
      // In line while ESPN can't be read (O4).
      delayed: boolean;
      // In line while the worker is down, so nothing has been sent (Dec-D31c, O13).
      notStarted: boolean;
      // In line at its adjustment while the worker is down: the swap is on ESPN, the adjustment
      // isn't (O13).
      adjustmentNotSent: boolean;
      // The lineup edit sent to ESPN, once claimed, and whether it differs from the one confirmed
      // (Dec-D29b, X24).
      sentEdit: SentEdit | null;
      // When each step of the run happened, from the request's events (the tracker).
      tracker: TrackerTimes;
      // In line behind the team's own earlier request (named), or another team's (never named).
      ahead: { kind: "own"; title: string } | { kind: "other" } | null;
      // The commissioner's email about a request waiting on them.
      alertEmail: AlertEmailState;
      // The request's record, oldest first.
      // `selfApproval`: the commissioner approved their own team's request (IF-DETAIL-4).
      events: {
        at: Date;
        type: RequestEventType;
        actor: RequestActorType;
        selfApproval?: boolean;
      }[];
      // What ESPN showed when a request refused at Confirm was confirmed; null for any other.
      refusal: RefusalDetail | null;
      // The starter the injured player replaced earlier that week, whose credit an "Earlier credit
      // given back" line returns (FS-REQUEST-14); null without such a line.
      creditGivenBackFor: string | null;
    };

export type RefusalDetail = {
  // The starter's designation, as ESPN sent it (DAY_TO_DAY).
  designation: string | null;
  // Where ESPN had the replacement, when its lineup listed him.
  replacementSlot: string | null;
  // The team's own request for the same starter that the refusal collided with.
  activeRequest: { requestId: string; title: string; status: SubRequestStatus } | null;
};

export type TrackerTimes = {
  checkedAt: Date | null;
  lineupSentAt: Date | null;
  lineupVerifiedAt: Date | null;
  adjustmentSentAt: Date | null;
  adjustmentVerifiedAt: Date | null;
  completedAt: Date | null;
};

export type SentEditMove = { playerId: number; name: string; fromSlot: string; toSlot: string };

export type SentEdit = {
  items: SentEditMove[];
  differsFromConfirmed: boolean;
  // The move confirmed, where the one sent differs from it (FS-REQUEST-17).
  confirmed: SentEditMove[] | null;
};

export const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// A rejection's event carries the commissioner's reason (Q7).
const rejectionSchema = z.object({ reason: z.string() });

const storedLinesSchema = z.array(
  z.object({
    day: z.number(),
    playerId: z.number(),
    tenths: z.number(),
    why: z.enum([
      "injured_credited_before_swap",
      "earlier_credit_forfeited",
      "replacement_after_request",
      "replacement_on_bench",
      "replacement_before_request",
    ]),
  })
);
// The projection as Confirm stored it in the request snapshot.
const storedProjectionSchema = z.object({
  projection: z.object({ lines: storedLinesSchema }).nullable(),
});

// A manager's history: their own team's requests only, newest first (H1, OQ7).
export async function loadTeamHistory(input: { teamId: number }): Promise<TeamHistory> {
  try {
    const rows = await listTeamRequests(getWebDatabaseConnection().db, input.teamId);
    return { status: "found", requests: rows.map(historyEntryOf) };
  } catch (error) {
    if (!isDatabaseQueryError(error)) throw error;
    logFailure(error, "history");
    return { status: "unavailable" };
  }
}

function historyEntryOf(row: SubRequestRecord): HistoryEntry {
  const { requestId, status, injuredName, replacementName, filedAt, matchupPeriodId } = row;
  return {
    requestId,
    status,
    injuredPlayerId: row.injuredPlayerId,
    injuredName,
    replacementPlayerId: row.replacementPlayerId,
    replacementName,
    filedAt,
    matchupPeriodId,
    amountTenths: requestAmountTenths(row),
  };
}

// One of the team's requests; another team's, or an id that isn't one, is not found.
export function loadRequestView(input: {
  teamId: number;
  requestId: string;
}): Promise<RequestView> {
  return loadVisibleRequestView(input.requestId, (teamId) => teamId === input.teamId);
}

// Any team's request, for the commissioner.
export function loadRequestViewForCommissioner(requestId: string): Promise<RequestView> {
  return loadVisibleRequestView(requestId, () => true);
}

async function loadVisibleRequestView(
  requestId: string,
  visible: (teamId: number) => boolean
): Promise<RequestView> {
  if (!REQUEST_ID.test(requestId)) return { status: "not_found" };
  try {
    const { db } = getWebDatabaseConnection();
    const detail = await getRequestDetail(db, requestId);
    if (detail === null || !visible(detail.request.teamId)) return { status: "not_found" };
    // A proving request is the commissioner's test, shown only on the proving page (S20).
    if (detail.request.kind === "proving") return { status: "proving" };
    const access = (await getEspnAccess(db))?.state ?? null;
    const lastBeatAt = (await getLatestWorkerHeartbeat(db))?.beatAt ?? null;
    const view = viewOf(detail, { access, workerDown: isWorkerDown(lastBeatAt, new Date()) });
    if (view.status !== "found") return view;
    const [ahead, alertEmail, activeRequest, creditGivenBackFor] = await Promise.all([
      aheadOf(db, detail.request),
      WAITS_ON_COMMISSIONER.includes(detail.request.status)
        ? findRequestAlertEmailState(db, detail.request.requestId)
        : Promise.resolve<AlertEmailState>({ state: "unknown" }),
      collidedWith(db, detail),
      view.breakdown.some((line) => line.why === "earlier_credit_forfeited")
        ? earlierSwapReplaced(db, detail.request)
        : Promise.resolve(null),
    ]);
    const refusal = view.refusal === null ? null : { ...view.refusal, activeRequest };
    return { ...view, ahead, alertEmail, refusal, creditGivenBackFor };
  } catch (error) {
    if (!isDatabaseQueryError(error)) throw error;
    logFailure(error, "request_view");
    return { status: "unavailable" };
  }
}

function viewOf(
  { request, snapshots, events }: RequestDetail,
  { access, workerDown }: { access: EspnAccessState | null; workerDown: boolean }
): RequestView {
  const rejection = events.findLast((event) => event.eventType === "rejected");
  const reason = rejectionSchema.safeParse(rejection?.payload);
  return {
    status: "found",
    request: {
      requestId: request.requestId,
      status: request.status,
      reviewReason: request.reviewReason,
      refusalReason: request.refusalReason,
      injuredName: request.injuredName,
      replacementName: request.replacementName,
      filedAt: request.filedAt,
      adjustmentTenths:
        request.finalAdjustmentTenths ??
        request.overrideAdjustmentTenths ??
        request.projectedAdjustmentTenths,
      adjustmentIsFinal: request.finalAdjustmentTenths !== null,
      effectiveDay: request.effectiveDay,
      rehearsal: request.isRehearsal,
      injuredPlayerId: request.injuredPlayerId,
      injuredSlot: request.injuredSlot,
      replacementPlayerId: request.replacementPlayerId,
      requestMoment: request.requestMoment,
      requestDay: request.requestDay,
      matchupPeriodId: request.matchupPeriodId,
    },
    breakdown: breakdownOf(request, snapshots),
    commissionerReason: reason.success ? reason.data.reason : null,
    canWithdraw: transition(
      request,
      { type: "withdraw" },
      { matchupEnded: false, writeGate: "open" }
    ).ok,
    delayed: espnBlockFor(request.status, access) !== null,
    ...whileWorkerDown(request, workerDown),
    sentEdit: sentEditView(request, snapshots, events),
    tracker: trackerOf(events),
    ahead: null,
    alertEmail: { state: "unknown" },
    events: events.flatMap((event) =>
      isRequestEventType(event.eventType)
        ? [
            {
              at: event.createdAt,
              type: event.eventType,
              actor: event.actorType,
              selfApproval: selfApprovalOf(event.payload),
            },
          ]
        : []
    ),
    refusal:
      request.status === "refused"
        ? {
            designation: request.designationAtRequest,
            replacementSlot: slotIn(snapshots, request.replacementPlayerId),
            activeRequest: null,
          }
        : null,
    creditGivenBackFor: null,
  };
}

const SETTLED: readonly SubRequestStatus[] = ["completed", "completed_manually"];

// The team's latest settled swap that week in which this request's injured player came in.
async function earlierSwapReplaced(
  db: DatabaseExecutor,
  request: SubRequestRecord
): Promise<string | null> {
  const earlier = (await listTeamRequests(db, request.teamId)).find(
    (other) =>
      other.requestId !== request.requestId &&
      other.season === request.season &&
      other.matchupPeriodId === request.matchupPeriodId &&
      other.replacementPlayerId === request.injuredPlayerId &&
      SETTLED.includes(other.status) &&
      other.createdAt < request.createdAt
  );
  return earlier?.injuredName ?? null;
}

// The refusal event names the request already standing for the starter (FM-CONFIRM-4).
const collisionSchema = z.object({ refusal: z.object({ activeRequestId: z.string() }) });

async function collidedWith(
  db: DatabaseExecutor,
  { request, events }: RequestDetail
): Promise<RefusalDetail["activeRequest"]> {
  if (request.status !== "refused") return null;
  const refusal = events.findLast((event) => event.eventType === "request_refused");
  const parsed = collisionSchema.safeParse(refusal?.payload);
  if (!parsed.success) return null;
  const other = await getRequestDetail(db, parsed.data.refusal.activeRequestId);
  if (other === null || other.request.teamId !== request.teamId) return null;
  return {
    requestId: other.request.requestId,
    title: `${lastName(other.request.replacementName)} in for ${lastName(other.request.injuredName)}`,
    status: other.request.status,
  };
}

// Where the request's snapshot lineup had a player, if it listed him.
const slotLineupSchema = z.object({
  lineup: z.record(
    z.string(),
    z.array(z.object({ slot: z.string(), player: z.object({ playerId: z.number() }).nullable() }))
  ),
});

function slotIn(snapshots: RequestDetail["snapshots"], playerId: number): string | null {
  for (const snapshot of snapshots) {
    const parsed = slotLineupSchema.safeParse(snapshot.payload);
    if (!parsed.success) continue;
    const held = Object.values(parsed.data.lineup)
      .flat()
      .find((slot) => slot.player?.playerId === playerId);
    if (held !== undefined) return held.slot;
  }
  return null;
}

const WAITS_ON_COMMISSIONER: readonly SubRequestStatus[] = ["awaiting_approval", "needs_review"];

function trackerOf(events: RequestDetail["events"]): TrackerTimes {
  const last = (type: RequestEventType) =>
    events.findLast((event) => event.eventType === type)?.createdAt ?? null;
  return {
    checkedAt: last("preflight_passed"),
    lineupSentAt: last("lineup_sent"),
    lineupVerifiedAt: last("lineup_verified"),
    adjustmentSentAt: last("adjustment_sent"),
    adjustmentVerifiedAt: last("adjustment_verified"),
    completedAt: last("completed"),
  };
}

// What a request in line waits behind: the team's own earlier one, named, else any other team's,
// never named (the executor takes the oldest queued request across teams).
async function aheadOf(
  db: DatabaseExecutor,
  request: SubRequestRecord
): Promise<{ kind: "own"; title: string } | { kind: "other" } | null> {
  if (request.status !== "queued") return null;
  const own = await findTeamEarlierInFlightRequest(db, request.teamId, request.createdAt);
  if (own !== null) {
    return {
      kind: "own",
      title: `${lastName(own.replacementName)} in for ${lastName(own.injuredName)}`,
    };
  }
  const other = await hasEarlierInFlightRequestElsewhere(db, request.teamId, request.createdAt);
  return other ? { kind: "other" } : null;
}

function lastName(name: string): string {
  const [, ...rest] = name.trim().split(/\s+/);
  return rest.length === 0 ? name : rest.join(" ");
}

// What a request in line can say while the worker is down: nothing sent while ESPN shows none of
// it, or only the adjustment waiting once its swap is on ESPN.
function whileWorkerDown(
  request: RequestDetail["request"],
  workerDown: boolean
): { notStarted: boolean; adjustmentNotSent: boolean } {
  const waiting = request.status === "queued" && workerDown;
  return {
    notStarted: waiting && (request.lineupState === "pending" || request.lineupState === "failed"),
    adjustmentNotSent: waiting && request.lineupState === "verified",
  };
}

// The players a request's snapshots name, from the lineups ESPN showed then.
const slotsSchema = z.array(
  z.object({ player: z.object({ playerId: z.number(), name: z.string() }).nullable() })
);
const snapshotLineupSchema = z.object({
  lineup: z.object({ starters: slotsSchema, bench: slotsSchema, injuredReserve: slotsSchema }),
});

function sentEditView(
  request: SubRequestRecord,
  snapshots: RequestDetail["snapshots"],
  events: RequestDetail["events"]
): SentEdit | null {
  const sent = sentEditOf(events.findLast((event) => event.eventType === "claimed")?.payload);
  if (sent === null) return null;
  const names = namesIn(request, snapshots);
  const named = (moves: LineupMove[]): SentEditMove[] =>
    moves.map(({ playerId, fromSlot, toSlot }) => ({
      playerId,
      name: names.get(playerId) ?? `player ${playerId}`,
      fromSlot,
      toSlot,
    }));
  return {
    items: named(sent.items),
    differsFromConfirmed: sent.confirmedItems !== null,
    confirmed: sent.confirmedItems === null ? null : named(sent.confirmedItems),
  };
}

// Each player's name, from the request and the lineups its snapshots kept.
export function namesIn(
  request: SubRequestRecord,
  snapshots: RequestDetail["snapshots"]
): Map<number, string> {
  const names = new Map([
    [request.injuredPlayerId, request.injuredName],
    [request.replacementPlayerId, request.replacementName],
  ]);
  for (const snapshot of snapshots) {
    const parsed = snapshotLineupSchema.safeParse(snapshot.payload);
    if (!parsed.success) continue;
    for (const slot of Object.values(parsed.data.lineup).flat()) {
      if (slot.player !== null) names.set(slot.player.playerId, slot.player.name);
    }
  }
  return names;
}

const COMPUTED_PHASES: readonly string[] = ["manual_completion", "adjustment_verified"];

// The lines behind the amount shown (A1): those the latest completion computed for its effective
// day, by hand or by the worker once ESPN showed its adjustment, else the projection Confirm
// stored.
export function breakdownOf(
  request: SubRequestRecord,
  snapshots: RequestDetail["snapshots"]
): BreakdownLine[] {
  const computed = snapshots
    .filter((each) => COMPUTED_PHASES.includes(each.phase))
    .map((each) => computedLinesOf(each.payload))
    .findLast((each) => each !== null);
  const lines = computed ?? projectedLines(snapshots);
  const names = new Map([
    [request.injuredPlayerId, request.injuredName],
    [request.replacementPlayerId, request.replacementName],
  ]);
  return lines.map(({ day, playerId, tenths, why }) => ({
    day,
    name: names.get(playerId) ?? `player ${playerId}`,
    tenths,
    why,
  }));
}

function projectedLines(snapshots: RequestDetail["snapshots"]) {
  const parsed = storedProjectionSchema.safeParse(
    snapshots.find((each) => each.phase === "request")?.payload
  );
  return parsed.success && parsed.data.projection !== null ? parsed.data.projection.lines : [];
}

function logFailure(error: unknown, flow: string): void {
  getWebLogger().error("web.requests.database_failed", undefined, {
    flow,
    reason: describeFailure(error),
  });
}

export function selfApprovalOf(payload: unknown): boolean {
  return typeof payload === "object" && payload !== null && "selfApproval" in payload
    ? payload.selfApproval === true
    : false;
}
