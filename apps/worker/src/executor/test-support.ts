import { randomUUID } from "node:crypto";
import { createLogger } from "@injurysub/config";
import {
  acquireWriteLease,
  createRequest,
  type DatabaseConnection,
  emailOutbox,
  getRequestDetail,
  listWriteAttempts,
  type NewSubRequest,
  readLeagueSettings,
  releaseWriteLease,
  userAccounts,
  type WriteAttemptRecord,
  writeLeagueSettings,
} from "@injurysub/db";
import { type LineupMove, planRecord } from "@injurysub/domain";
import { vi } from "vitest";
import { createFakeEspn, type FakeEspn } from "../fake-espn";
import { sendWrite } from "./espn-write";
import { type ClaimedForLineup } from "./lineup-step";
import { type ExecutorContext, preflightRequest } from "./preflight";

// What the executor's database tests share: team 1 as the fake ESPN holds it, a queued request,
// the pass's context, and reads of what a pass left behind. Test code only.

// Team 1 as the recordings hold it (ESPN's day 8, matchup period 2): Towns at C, Tatum at F,
// Clingan at F/C; Sharpe (C, F/C) and Larsson (F) on the bench. Nobody is OUT until a test says.
export const TEAM = 1;
export const TOWNS = 3136195;
export const SHARPE = 4432194;
export const TATUM = 4065648;
export const LARSSON = 4601025;
export const CLINGAN = 5105565;
// Lillard at G; Edey (a center) on the bench takes a UTIL once a UTIL starter who can play G moves
// to Lillard's slot. Of the two UTIL starters, only the guard can.
export const LILLARD = 6606;
export const EDEY = 4600663;
export const UTIL_GUARD = 4900671;
export const UTIL_FORWARD = 4278562;
export const lillardForEdey = {
  injuredPlayerId: LILLARD,
  injuredName: "Damian Lillard",
  injuredSlot: "G",
  replacementPlayerId: EDEY,
  replacementName: "Zach Edey",
};
export const utilGuardMoves: LineupMove[] = [
  { playerId: LILLARD, fromSlot: "G", toSlot: "BE" },
  { playerId: UTIL_GUARD, fromSlot: "UTIL", toSlot: "G" },
  { playerId: EDEY, fromSlot: "BE", toSlot: "UTIL" },
];

export const now = new Date("2026-10-27T20:00:00.000Z");
export const minutesFrom = (at: Date, minutes: number) => new Date(at.getTime() + minutes * 60_000);

export type Setup = {
  connection: DatabaseConnection;
  fake: FakeEspn;
  commissioner: string;
  matchupId: number;
};

// The commissioner (team 1, invented), automation on for `allowlist` in auto mode, and the fake.
export async function setUp(connection: DatabaseConnection, allowlist = [TEAM]): Promise<Setup> {
  const commissioner = randomUUID();
  await connection.db.insert(userAccounts).values({
    userId: commissioner,
    email: `commissioner-${commissioner}@example.test`,
    teamId: TEAM,
    displayName: "Invented Commissioner",
    role: "commissioner",
  });
  await writeLeagueSettings(connection.db, {
    executionMode: "auto",
    writeAllowlist: allowlist,
    updatedBy: commissioner,
    now,
    shownUpdatedAt: null,
  });
  const fake = await createFakeEspn();
  vi.stubGlobal("fetch", fake.fetch);
  const { matchup } = await fake.read.getTeamWeek(TEAM);
  if (matchup === null) throw new Error("team 1 has no recorded matchup");
  return { connection, fake, commissioner, matchupId: matchup.matchupId };
}

// A queued request on team 1: Towns out, Sharpe in, filed an hour ago and expiring in 11 hours.
export function queuedRequest(setup: Setup, overrides: Partial<NewSubRequest>): NewSubRequest {
  return {
    requestId: randomUUID(),
    kind: "substitution",
    teamId: TEAM,
    season: 2027,
    matchupPeriodId: 2,
    matchupId: setup.matchupId,
    requestedBy: setup.commissioner,
    idempotencyKey: randomUUID(),
    injuredPlayerId: TOWNS,
    injuredName: "Karl-Anthony Towns",
    injuredSlot: "C",
    replacementPlayerId: SHARPE,
    replacementName: "Day'Ron Sharpe",
    requestMoment: minutesFrom(now, -60),
    filedAt: minutesFrom(now, -60),
    requestDay: 8,
    designationAtRequest: "OUT",
    status: "queued",
    executionModeAtRequest: "auto",
    expiresAt: minutesFrom(now, 11 * 60),
    projectedAdjustmentTenths: 0,
    createdAt: minutesFrom(now, -60),
    ...overrides,
  };
}

// The request snapshot holds the edit confirmed when `plan` is given, as Confirm records it.
export async function insertQueued(
  setup: Setup,
  overrides: Partial<NewSubRequest> = {},
  plan: LineupMove[] | null = null
) {
  const request = queuedRequest(setup, overrides);
  const confirmed = plan === null ? {} : planRecord({ items: plan, movedStarters: 1 });
  await createRequest(setup.connection.db, {
    request,
    snapshot: {
      snapshotId: randomUUID(),
      espnDay: 8,
      takenAt: request.createdAt ?? now,
      payload: { lineup: { teamId: TEAM, teamName: "Invented Hoopers" }, ...confirmed },
    },
    event: {
      eventId: randomUUID(),
      actorType: "manager",
      actorUserId: setup.commissioner,
      eventType: "request_filed",
      payload: {},
      createdAt: request.createdAt ?? now,
    },
    email: null,
  });
  return request.requestId;
}

// Without a write client the pass ends at the claim. Each clock reading is a second after the
// last, so the events after the claim keep their order.
export function contextFor(setup: Setup, at: Date = now): ExecutorContext {
  let ticks = 0;
  return {
    connection: setup.connection,
    espn: setup.fake.read,
    write: null,
    holder: "worker-under-test",
    now: at,
    clock: () => new Date(at.getTime() + ++ticks * 1000),
    sleep: async () => {},
    logger: createLogger("worker"),
  };
}

// The pass goes on to send through the fake ESPN.
export function sendingContextFor(setup: Setup): ExecutorContext {
  return { ...contextFor(setup), write: setup.fake.write };
}

export async function detailOf(setup: Setup, requestId: string) {
  const detail = await getRequestDetail(setup.connection.db, requestId);
  if (detail === null) throw new Error(`request ${requestId} is gone`);
  return detail;
}

export async function outbox(setup: Setup) {
  return setup.connection.db.select().from(emailOutbox);
}

// The players' slots on one of team 1's days, as ESPN shows them.
export async function slotsOn(setup: Setup, day: number, ...players: number[]) {
  const { day: teamDay } = await setup.fake.read.getTeamDay(TEAM, day);
  return players.map((id) => teamDay.players.find((player) => player.playerId === id)?.slot);
}

export async function attemptsOf(setup: Setup, requestId: string): Promise<WriteAttemptRecord[]> {
  return listWriteAttempts(setup.connection.db, requestId);
}

// The players a lineup POST moved, in the order sent.
export function postedPlayers(setup: Setup, index = 0): number[] {
  const body = setup.fake.posts[index]?.body as { items: { playerId: number }[] } | undefined;
  return body?.items.map((item) => item.playerId) ?? [];
}

// Preflight and the claim under this worker's lease, stopping before the lineup step.
export async function claimForLineup(setup: Setup, requestId: string) {
  const lease = await acquireWriteLease(setup.connection.db, {
    holder: "worker-under-test",
    ttlSeconds: 60,
  });
  if (lease === null) throw new Error("expected the lease");
  const queued = (await detailOf(setup, requestId)).request;
  const claimed = await preflightRequest({ ...contextFor(setup), lease }, queued);
  if (claimed.kind !== "claimed" || claimed.resumeAt !== "lineup") {
    throw new Error(`expected a lineup claim, got ${claimed.kind}`);
  }
  return { lease, claimed: claimed satisfies ClaimedForLineup };
}

// The commissioner saves the settings with only team 2 automated, as mid-run.
export async function takeTeamOffAllowlist(setup: Setup) {
  const settings = await readLeagueSettings(setup.connection.db);
  await writeLeagueSettings(setup.connection.db, {
    executionMode: "auto",
    writeAllowlist: [2],
    updatedBy: setup.commissioner,
    now: minutesFrom(now, 1),
    shownUpdatedAt: settings.updatedAt,
  });
}

// Tatum (40.4 points while starting on day 7) out at F, Larsson in: once the swap is effective on
// day 8, Tatum's day-7 points are owed back, −40.4.
export const tatumForLarsson = {
  injuredPlayerId: TATUM,
  injuredName: "Jayson Tatum",
  injuredSlot: "F",
  replacementPlayerId: LARSSON,
  replacementName: "Jake Larsson",
};
export const TATUM_OWED = -404;

export async function recordedMatchup(setup: Setup) {
  const { week } = await setup.fake.read.getCurrentWeek();
  const matchup = week.matchups.find((each) => each.matchupId === setup.matchupId);
  if (matchup === undefined || matchup.away === null) throw new Error("team 1's matchup is gone");
  return matchup;
}

export async function sideOf(setup: Setup, which: "team" | "opponent") {
  const matchup = await recordedMatchup(setup);
  const team = matchup.home.teamId === TEAM ? matchup.home : matchup.away;
  const opponent = matchup.home.teamId === TEAM ? matchup.away : matchup.home;
  const side = which === "team" ? team : opponent;
  if (side === null) throw new Error("team 1's matchup has one side");
  return side;
}

// An LM write on ESPN outside the app, as the commissioner or an earlier request would make.
export async function setSide(
  setup: Setup,
  which: "team" | "opponent",
  tenths: number,
  reason: string
) {
  const { teamId } = await sideOf(setup, which);
  await setup.fake.write.applyAdjustment(
    { matchup: await recordedMatchup(setup), teamId, targetTenths: tenths, reason },
    { allowlist: new Set([teamId]), beforeSend: async () => {} }
  );
}

export async function insertTatumRequest(setup: Setup, overrides: Partial<NewSubRequest> = {}) {
  setup.fake.setDesignation(TATUM, "OUT");
  return insertQueued(setup, { ...tatumForLarsson, ...overrides });
}

// A pass that sent a write and stopped before recording ESPN's answer: the attempt's `sending` row
// and whatever ESPN did with the body, as a restart or a lost lease leaves them.
export async function sendThenStop(
  setup: Setup,
  attempt: { requestId: string; kind: "lineup" | "adjustment" },
  send: Parameters<typeof sendWrite>[3]
) {
  const lease = await acquireWriteLease(setup.connection.db, {
    holder: "stopped-worker",
    ttlSeconds: 60,
  });
  if (lease === null) throw new Error("expected the lease");
  const context = { ...sendingContextFor(setup), lease, write: setup.fake.write };
  const write = { ...attempt, teamId: TEAM, matchupId: setup.matchupId, scoringPeriodId: 8 };
  await sendWrite(context, write, new Set([TEAM]), send);
  await releaseWriteLease(setup.connection.db, lease);
}

export async function claimedAndStopped(setup: Setup, requestId: string) {
  const { lease, claimed } = await claimForLineup(setup, requestId);
  await releaseWriteLease(setup.connection.db, lease);
  return claimed;
}
