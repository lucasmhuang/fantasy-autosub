import {
  describeFailure,
  getEspnAccess,
  getRequestDetail,
  isDatabaseQueryError,
  listTeamRequests,
  type RequestDetail,
  type SubRequestRecord,
} from "@injurysub/db";
import {
  type AdjustmentLine,
  type EspnAccessState,
  espnBlockFor,
  type ReviewReason,
  type SubRequestStatus,
  transition,
} from "@injurysub/domain";
import { z } from "zod";
import { getWebDatabaseConnection } from "./db";
import { getWebLogger } from "./logger";

export type HistoryEntry = {
  requestId: string;
  status: SubRequestStatus;
  injuredName: string;
  replacementName: string;
  filedAt: Date;
};

export type TeamHistory = { status: "unavailable" } | { status: "found"; requests: HistoryEntry[] };

export type BreakdownLine = {
  day: number;
  name: string;
  tenths: number;
  why: AdjustmentLine["why"];
};

export type RequestView =
  | { status: "not_found" | "unavailable" }
  | {
      status: "found";
      request: {
        requestId: string;
        status: SubRequestStatus;
        reviewReason: ReviewReason | null;
        refusalReason: string | null;
        injuredName: string;
        replacementName: string;
        filedAt: Date;
        // The final amount once settled, else the commissioner's override, else the projection.
        adjustmentTenths: number | null;
        adjustmentIsFinal: boolean;
        effectiveDay: number | null;
      };
      breakdown: BreakdownLine[];
      commissionerReason: string | null;
      canWithdraw: boolean;
      // While it's in line or in progress, the page reloads itself (OQ6).
      refreshing: boolean;
      // In line while ESPN can't be read (O4).
      delayed: boolean;
    };

export const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MOVING: readonly SubRequestStatus[] = ["queued", "executing"];

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
// What a manual completion computed for its effective day, in its snapshot.
const storedCompletionSchema = z.object({ computed: z.object({ lines: storedLinesSchema }) });

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
  const { requestId, status, injuredName, replacementName, filedAt } = row;
  return { requestId, status, injuredName, replacementName, filedAt };
}

// One of the team's requests; another team's, or an id that isn't one, is not found.
export async function loadRequestView(input: {
  teamId: number;
  requestId: string;
}): Promise<RequestView> {
  if (!REQUEST_ID.test(input.requestId)) return { status: "not_found" };
  try {
    const { db } = getWebDatabaseConnection();
    const detail = await getRequestDetail(db, input.requestId);
    if (detail === null || detail.request.teamId !== input.teamId) return { status: "not_found" };
    return viewOf(detail, (await getEspnAccess(db))?.state ?? null);
  } catch (error) {
    if (!isDatabaseQueryError(error)) throw error;
    logFailure(error, "request_view");
    return { status: "unavailable" };
  }
}

function viewOf(
  { request, snapshots, events }: RequestDetail,
  access: EspnAccessState | null
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
    },
    breakdown: breakdownOf(request, snapshots),
    commissionerReason: reason.success ? reason.data.reason : null,
    canWithdraw: transition(
      request,
      { type: "withdraw" },
      { matchupEnded: false, writeGate: "open" }
    ).ok,
    refreshing: MOVING.includes(request.status),
    delayed: espnBlockFor(request.status, access) !== null,
  };
}

// The lines behind the amount shown (A1): those a manual completion computed for its effective
// day, else the projection Confirm stored.
export function breakdownOf(
  request: SubRequestRecord,
  snapshots: RequestDetail["snapshots"]
): BreakdownLine[] {
  const completion = storedCompletionSchema.safeParse(
    snapshots.findLast((each) => each.phase === "manual_completion")?.payload
  );
  const lines = completion.success ? completion.data.computed.lines : projectedLines(snapshots);
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
