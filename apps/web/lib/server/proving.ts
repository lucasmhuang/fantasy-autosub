import { randomUUID } from "node:crypto";
import {
  appendEvent,
  type DatabaseExecutor,
  describeFailure,
  getRequestDetail,
  isDatabaseQueryError,
  listProvingRequests,
  listWriteAttempts,
  markProvingDone,
  type RequestDetail,
  readLeagueSettings,
  type SubRequestRecord,
  transitionRequest,
  type WriteAttemptRecord,
} from "@injurysub/db";
import {
  inverseEdit,
  isAutomatableEdit,
  type LineupMove,
  PROVING_TEAM_ID,
  PROVING_TOKEN_TENTHS,
  planLineupEdit,
  type ReviewReason,
  type SubRequestStatus,
  sentEditOf,
  transition,
  type WriteGate,
  writeGateFor,
} from "@injurysub/domain";
import type { TeamWeekRead } from "@injurysub/espn";
import { z } from "zod";
import { readTeamWeek } from "./board";
import { swapMayBeOnEspn } from "./commish-actions";
import { getWebDatabaseConnection } from "./db";
import { isWorkerRehearsing } from "./espn";
import { getWebLogger } from "./logger";
import { REQUEST_ID } from "./request-view";
import { confirmFiling, editDigest, type Submission, type SubmitResult } from "./requests";

export type ProvingActionResult = {
  status:
    | "cancelled"
    | "proving_marked_done"
    | "not_allowed"
    | "changed"
    | "not_found"
    | "invalid_form"
    | "unavailable";
};

const CANCEL_REASON = "Cancelled by the commissioner.";

export type NamedMove = { name: string; fromSlot: string; toSlot: string };

// A bench player the app can put in for the chosen starter, as the proving request would send it.
export type ProvingOption = {
  playerId: number;
  name: string;
  kind: "direct_swap" | "one_move";
  moves: NamedMove[];
  // The edit as the filing form carries it, which filing checks against ESPN then (R4).
  digest: string;
};

export type ProvingStarter = { playerId: number; name: string; slot: string; designation: string };

export type ProvingChoices =
  | { status: "not_connected" | "credentials_rejected" | "unavailable" | "no_matchup" }
  | {
      status: "found";
      teamName: string;
      period: number;
      starters: ProvingStarter[];
      chosen: number | null;
      options: ProvingOption[];
    };

export type ProvingWrite = {
  step: "swap" | "token" | "revert" | "restore";
  status: string;
  outcome: string | null;
  sentAt: Date;
  // ESPN's status and error type for a write it refused, when the worker kept them.
  espnAnswer: string | null;
};

// Where a stopped run stands and what to put back on ESPN by hand, from what it sent (S15).
export type ProvingStop = {
  step: string | null;
  detail: string | null;
  restoreMoves: NamedMove[] | null;
  sideToRestore: { tenths: number; reason: string } | null;
  earlierDayKeepsSwap: boolean;
};

export type ProvingRequestView = {
  requestId: string;
  version: number;
  status: SubRequestStatus;
  reviewReason: ReviewReason | null;
  filedAt: Date;
  injuredName: string;
  replacementName: string;
  rehearsal: boolean;
  writes: ProvingWrite[];
  approve: { shownTenths: number } | null;
  cancel: boolean;
  putBack: boolean;
  stopped: ProvingStop | null;
};

export type ProvingPage =
  | { status: "unavailable" }
  | {
      status: "found";
      rehearsal: boolean;
      provingDoneAt: Date | null;
      choices: ProvingChoices | null;
      requests: ProvingRequestView[];
    };

type ProvingRecord = { detail: RequestDetail; attempts: WriteAttemptRecord[] };
type Names = ReadonlyMap<number, string>;

// A lineup's players by id, from ESPN's read or the one a request snapshot kept.
const slotSchema = z.object({
  player: z.object({ playerId: z.number(), name: z.string() }).nullable(),
});
const lineupSchema = z.object({
  starters: z.array(slotSchema),
  bench: z.array(slotSchema),
  injuredReserve: z.array(slotSchema),
});
const filedSchema = z.object({ lineup: lineupSchema });
const reviewSchema = z.object({ proving: z.string().optional(), detail: z.string().optional() });
const sideReadSchema = z.object({ tenths: z.number().int(), reason: z.string() });
const answeredSchema = z.object({
  writeId: z.string(),
  espnAnswer: z.string().regex(/^HTTP \d{3}( [A-Z_]+)?$/),
});
const OPEN = { matchupEnded: false, writeGate: "open" as const };

// The proving page (S18-S20): what can be filed for team 1 until proving is done, and every
// proving request with its writes, its actions and, once stopped, what to put back by hand.
export async function loadProvingPage(input: { starterId: number | null }): Promise<ProvingPage> {
  const stored = await readProvingRecords();
  if (stored === "unavailable") return { status: "unavailable" };
  const { settings, records } = stored;
  const gate = writeGateFor(settings.writeAllowlist, PROVING_TEAM_ID);
  const choices = settings.provingDoneAt === null ? await provingChoices(input.starterId) : null;
  return {
    status: "found",
    rehearsal: await isWorkerRehearsing(),
    provingDoneAt: settings.provingDoneAt,
    choices,
    requests: records.map((record) => requestViewOf(record, gate)),
  };
}

async function readProvingRecords() {
  try {
    const { db } = getWebDatabaseConnection();
    const settings = await readLeagueSettings(db);
    const records: ProvingRecord[] = [];
    for (const row of await listProvingRequests(db)) {
      const detail = await getRequestDetail(db, row.requestId);
      if (detail === null) continue;
      records.push({ detail, attempts: await listWriteAttempts(db, row.requestId) });
    }
    return { settings, records };
  } catch (error) {
    if (!isDatabaseQueryError(error)) throw error;
    logFailure(error, "proving_page");
    return "unavailable" as const;
  }
}

// Team 1's starters as ESPN has them now, and for the one chosen each bench player the app may
// put in on its own: a direct swap or a one-move rearrangement, never two moves (S9, S19).
async function provingChoices(starterId: number | null): Promise<ProvingChoices> {
  const read = await readTeamWeek(PROVING_TEAM_ID);
  if ("status" in read) return read;
  if (read.matchup === null) return { status: "no_matchup" };
  const starters = read.lineup.starters.flatMap(({ slot, player }) =>
    player === null
      ? []
      : [
          {
            playerId: player.playerId,
            name: player.name,
            slot,
            designation: player.designation.status,
          },
        ]
  );
  const chosen = starters.find((each) => each.playerId === starterId)?.playerId ?? null;
  return {
    status: "found",
    teamName: read.lineup.teamName,
    period: read.week.matchupPeriodId,
    starters,
    chosen,
    options: chosen === null ? [] : optionsFor(read, chosen),
  };
}

function optionsFor(read: TeamWeekRead, injuredPlayerId: number): ProvingOption[] {
  const names = namesIn(read.lineup);
  return read.lineup.bench.flatMap(({ player }) => {
    if (player === null) return [];
    const replacementPlayerId = player.playerId;
    const edit = planLineupEdit({ lineup: read.lineup, injuredPlayerId, replacementPlayerId });
    if (edit === null || !isAutomatableEdit(edit)) return [];
    const kind = edit.movedStarters === 0 ? ("direct_swap" as const) : ("one_move" as const);
    const moves = edit.items.map((move) => namedMove(names, move));
    return [
      {
        playerId: replacementPlayerId,
        name: player.name,
        kind,
        moves,
        digest: editDigest(edit.items),
      },
    ];
  });
}

type NamedSlot = { readonly player: { readonly playerId: number; readonly name: string } | null };
type NamedLineup = Record<"starters" | "bench" | "injuredReserve", readonly NamedSlot[]>;

function namesIn(lineup: NamedLineup): Map<number, string> {
  const slots = [...lineup.starters, ...lineup.bench, ...lineup.injuredReserve];
  return new Map(
    slots.flatMap(({ player }) =>
      player === null ? [] : [[player.playerId, player.name] as const]
    )
  );
}

function namedMove(names: Names, move: LineupMove): NamedMove {
  const name = names.get(move.playerId) ?? `player ${move.playerId}`;
  return { name, fromSlot: move.fromSlot, toSlot: move.toSlot };
}

function requestViewOf(record: ProvingRecord, gate: WriteGate): ProvingRequestView {
  const { detail } = record;
  const { request } = detail;
  const writes = writesOf(record);
  const { requestId, version, status, reviewReason, filedAt, injuredName, replacementName } =
    request;
  const approvable = transition(
    request,
    { type: "approve" },
    { matchupEnded: false, writeGate: gate }
  );
  const closable = transition(request, { type: "complete_manually" }, OPEN).ok;
  return {
    requestId,
    version,
    status,
    reviewReason,
    filedAt,
    injuredName,
    replacementName,
    rehearsal: request.isRehearsal,
    writes,
    approve: approvable.ok ? { shownTenths: PROVING_TOKEN_TENTHS } : null,
    cancel: transition(request, { type: cancelTypeFor(request) }, OPEN).ok,
    putBack: closable && swapMayBeOnEspn(request),
    stopped: status === "needs_review" ? stopOf(detail, writes) : null,
  };
}

// A run's writes in the order sent: a lineup write before any adjustment is the swap, one after
// it the restore; the first adjustment is the test adjustment, the next its revert.
function writesOf({ detail, attempts }: ProvingRecord): ProvingWrite[] {
  const answers = espnAnswersOf(detail.events);
  let adjustments = 0;
  return attempts.map(({ writeId, kind, status, outcome, sentAt }) => {
    const step = stepOf(kind, adjustments);
    if (kind === "adjustment") adjustments += 1;
    return { step, status, outcome, sentAt, espnAnswer: answers.get(writeId) ?? null };
  });
}

// ESPN's own answer to each write it refused, by write: its status and error type as the worker
// kept them. Any other text on an answer (a parser's message quoting what ESPN sent) is left out.
function espnAnswersOf(events: RequestDetail["events"]): Map<string, string> {
  const answers = new Map<string, string>();
  for (const event of events) {
    const answered = answeredSchema.safeParse(event.payload);
    if (answered.success) answers.set(answered.data.writeId, answered.data.espnAnswer);
  }
  return answers;
}

function stepOf(kind: WriteAttemptRecord["kind"], adjustmentsBefore: number): ProvingWrite["step"] {
  if (kind === "lineup") return adjustmentsBefore === 0 ? "swap" : "restore";
  return adjustmentsBefore === 0 ? "token" : "revert";
}

// What a stopped run leaves to put back, from what it sent, not from the step it stopped at: a
// test adjustment ESPN declined or never answered can still land after its readback (AC5-4).
function stopOf(detail: RequestDetail, writes: ProvingWrite[]): ProvingStop {
  const review = reviewSchema.safeParse(
    detail.events.findLast((event) => event.eventType === "sent_to_review")?.payload
  );
  const why = review.success ? review.data : {};
  return {
    step: why.proving ?? null,
    detail: why.detail ?? null,
    restoreMoves: restoreMovesOf(detail, writes),
    sideToRestore: sideToRestoreOf(detail, writes),
    earlierDayKeepsSwap: why.detail === "day_changed",
  };
}

// The swap's items reversed, in the order to make them, while the swap is or may be on ESPN and
// no restore read back.
function restoreMovesOf(detail: RequestDetail, writes: ProvingWrite[]): NamedMove[] | null {
  const { request, events, snapshots } = detail;
  if (!swapMayBeOnEspn(request)) return null;
  if (writes.some(({ step, outcome }) => step === "restore" && outcome === "verified")) return null;
  const sent = sentEditOf(events.findLast((event) => event.eventType === "claimed")?.payload);
  if (sent === null) return null;
  const filed = filedSchema.safeParse(snapshots.find(({ phase }) => phase === "request")?.payload);
  const names = filed.success ? namesIn(filed.data.lineup) : new Map<number, string>();
  return inverseEdit(sent.items).map((move) => namedMove(names, move));
}

// Team 1's side as read before the test adjustment, whenever one went out and no revert read back.
function sideToRestoreOf(
  detail: RequestDetail,
  writes: ProvingWrite[]
): { tenths: number; reason: string } | null {
  const token = writes.find(({ step }) => step === "token");
  if (token === undefined || token.status === "recorded_only") return null;
  if (writes.some(({ step, outcome }) => step === "revert" && outcome === "verified")) return null;
  const read = sideReadSchema.safeParse(
    detail.events.findLast((event) => event.eventType === "proving_side_read")?.payload
  );
  return read.success ? read.data : null;
}

// Cancel withdraws a proving request ESPN hasn't been touched for, and rejects one whose swap ESPN
// refused (S19).
function cancelTypeFor(request: SubRequestRecord): "reject" | "withdraw" {
  return request.lineupState === "failed" ? "reject" : "withdraw";
}

// The commissioner files a proving request on team 1, as Confirm files a substitution: checked
// against ESPN now and the edit the page showed. The domain refuses the rest (S9, S19).
export function fileProvingRequest(input: {
  user: Submission["user"];
  form: FormData;
  now: Date;
}): Promise<SubmitResult> {
  return confirmFiling(input, { kind: "proving", teamId: PROVING_TEAM_ID });
}

// Cancel closes a proving request with nothing on ESPN (S19): withdrawn while it waits, is queued
// or is in review untouched, so the worker never runs it; rejected once ESPN refused its swap.
// One whose swap is or may be on ESPN is closed by hand instead.
export async function cancelProvingRequest(input: {
  actorUserId: string;
  form: FormData;
  now: Date;
}): Promise<ProvingActionResult> {
  const requestId = input.form.get("request");
  const shownVersion = input.form.get("version");
  if (typeof requestId !== "string" || !REQUEST_ID.test(requestId)) return { status: "not_found" };
  if (typeof shownVersion !== "string" || !/^\d+$/.test(shownVersion)) {
    return { status: "invalid_form" };
  }
  const cancel = { ...input, requestId, version: Number(shownVersion) };
  try {
    return await getWebDatabaseConnection().transaction((tx) => cancelIn(tx, cancel));
  } catch (error) {
    if (!isDatabaseQueryError(error)) throw error;
    logFailure(error, "proving_cancel");
    return { status: "unavailable" };
  }
}

async function cancelIn(
  tx: DatabaseExecutor,
  cancel: { actorUserId: string; requestId: string; version: number; now: Date }
): Promise<ProvingActionResult> {
  const detail = await getRequestDetail(tx, cancel.requestId);
  if (detail === null || detail.request.kind !== "proving") return { status: "not_found" };
  const { request } = detail;
  if (request.version !== cancel.version) return { status: "changed" };
  const type = cancelTypeFor(request);
  const result = transition(request, { type }, OPEN);
  if (!result.ok) return { status: "not_allowed" };
  const moved = await transitionRequest(tx, {
    requestId: request.requestId,
    fromStatus: request.status,
    version: request.version,
    patch: { status: result.status, reviewReason: result.reviewReason },
    now: cancel.now,
  });
  if (moved === null) return { status: "changed" };
  await appendEvent(tx, request.requestId, {
    eventId: randomUUID(),
    actorType: "commissioner",
    actorUserId: cancel.actorUserId,
    eventType: type === "reject" ? "rejected" : "withdrawn",
    payload: { proving: true, from: request.status, reason: CANCEL_REASON },
    createdAt: cancel.now,
  });
  return { status: "cancelled" };
}

// Marks proving done (S9): no new proving request can be filed after it.
export async function markProvingDoneBy(input: {
  actorUserId: string;
  now: Date;
}): Promise<ProvingActionResult> {
  try {
    const db = getWebDatabaseConnection().db;
    await markProvingDone(db, { updatedBy: input.actorUserId, now: input.now });
    getWebLogger().info("web.commish.proving_marked_done", {});
    return { status: "proving_marked_done" };
  } catch (error) {
    if (!isDatabaseQueryError(error)) throw error;
    logFailure(error, "proving_done");
    return { status: "unavailable" };
  }
}

function logFailure(error: unknown, flow: string): void {
  getWebLogger().error("web.commish.database_failed", undefined, {
    flow,
    reason: describeFailure(error),
  });
}
