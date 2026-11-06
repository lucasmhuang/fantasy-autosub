import {
  describeFailure,
  getRequestDetail,
  isDatabaseQueryError,
  listTeamRequests,
  type RequestDetail,
  type SubRequestRecord,
} from "@injurysub/db";
import {
  type AdjustmentLine,
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
    };

export const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MOVING: readonly SubRequestStatus[] = ["queued", "executing"];

// A rejection's event carries the commissioner's reason (Q7).
const rejectionSchema = z.object({ reason: z.string() });

// The projection as Confirm stored it in the request snapshot.
const storedProjectionSchema = z.object({
  projection: z
    .object({
      lines: z.array(
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
      ),
    })
    .nullable(),
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
    const detail = await getRequestDetail(getWebDatabaseConnection().db, input.requestId);
    if (detail === null || detail.request.teamId !== input.teamId) return { status: "not_found" };
    return viewOf(detail);
  } catch (error) {
    if (!isDatabaseQueryError(error)) throw error;
    logFailure(error, "request_view");
    return { status: "unavailable" };
  }
}

function viewOf({ request, snapshots, events }: RequestDetail): RequestView {
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
    breakdown: breakdownOf(request, snapshots.find((each) => each.phase === "request")?.payload),
    commissionerReason: reason.success ? reason.data.reason : null,
    canWithdraw: transition(
      request,
      { type: "withdraw" },
      { matchupEnded: false, writeGate: "open" }
    ).ok,
    refreshing: MOVING.includes(request.status),
  };
}

export function breakdownOf(request: SubRequestRecord, payload: unknown): BreakdownLine[] {
  const parsed = storedProjectionSchema.safeParse(payload);
  if (!parsed.success || parsed.data.projection === null) return [];
  const names = new Map([
    [request.injuredPlayerId, request.injuredName],
    [request.replacementPlayerId, request.replacementName],
  ]);
  return parsed.data.projection.lines.map(({ day, playerId, tenths, why }) => ({
    day,
    name: names.get(playerId) ?? `player ${playerId}`,
    tenths,
    why,
  }));
}

function logFailure(error: unknown, flow: string): void {
  getWebLogger().error("web.requests.database_failed", undefined, {
    flow,
    reason: describeFailure(error),
  });
}
