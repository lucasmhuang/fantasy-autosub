import type { NewSubRequest } from "@injurysub/db";
import { PROVING_REASON_ENTRY } from "@injurysub/domain";
import type { LineupRead } from "@injurysub/espn";
import { afterEach, beforeEach, describe, expect, vi } from "vitest";
import { dbTest } from "../test-support";
import { runExecutorPass } from "./executor";
import type { ExecutorContext } from "./preflight";
import {
  attemptsOf,
  detailOf,
  EDEY,
  insertQueued,
  insertTatumRequest,
  LARSSON,
  LILLARD,
  lillardForEdey,
  postedPlayers,
  type Setup,
  SHARPE,
  sendingContextFor,
  setSide,
  setUp,
  sideOf,
  slotsOn,
  TATUM,
  TEAM,
  TOWNS,
  tatumForLarsson,
  UTIL_GUARD,
} from "./test-support";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Towns (C) for Sharpe on the bench: a direct swap.
const townsForSharpe = {
  injuredPlayerId: TOWNS,
  injuredName: "Karl-Anthony Towns",
  injuredSlot: "C",
  replacementPlayerId: SHARPE,
  replacementName: "Day'Ron Sharpe",
};

type ScheduleSide = { teamId: number; adjustment: number; adjustmentReason: string };
type ScheduleBody = [{ id: number; home: ScheduleSide; away: ScheduleSide }];

// The starter's designation as ESPN shows it, which a proving request is filed on: it skips the
// OUT check, so whatever he carries is what preflight compares.
async function designationOf(setup: Setup, playerId: number): Promise<string> {
  const { team } = await setup.fake.read.getLineup(TEAM);
  const slot = team.starters.find(({ player }) => player?.playerId === playerId);
  return slot?.player?.designation.status ?? "";
}

// A queued proving request on team 1, filed by the commissioner, with no amount approved.
async function insertProving(
  setup: Setup,
  players: Pick<
    NewSubRequest,
    "injuredPlayerId" | "injuredName" | "injuredSlot" | "replacementPlayerId" | "replacementName"
  >
) {
  return insertQueued(setup, {
    kind: "proving",
    ...players,
    designationAtRequest: await designationOf(setup, players.injuredPlayerId),
    projectedAdjustmentTenths: null,
  });
}

function postKinds(setup: Setup): string[] {
  return setup.fake.posts.map((post) => post.kind);
}

// Team 1's side in a schedule POST.
function teamSideIn(setup: Setup, index: number): ScheduleSide {
  const [matchup] = setup.fake.posts[index]?.body as ScheduleBody;
  return matchup.home.teamId === TEAM ? matchup.home : matchup.away;
}

function lineupDayIn(setup: Setup, index: number): number | undefined {
  return (setup.fake.posts[index]?.body as { scoringPeriodId?: number }).scoringPeriodId;
}

// ESPN's day moves on once `afterPosts` writes have reached it, as at midnight Pacific.
function dayChangesAfter(setup: Setup, afterPosts: number): ExecutorContext["espn"] {
  const nextDay = (read: LineupRead): LineupRead => ({
    ...read,
    meta: { ...read.meta, scoringPeriodId: read.meta.scoringPeriodId + 1 },
  });
  return {
    ...setup.fake.read,
    getLineup: async (teamId) => {
      const read = await setup.fake.read.getLineup(teamId);
      return setup.fake.posts.length >= afterPosts ? nextDay(read) : read;
    },
  };
}

describe("the proving run", () => {
  dbTest(
    "swaps, writes 0.1 with the test note, reverts it and restores the lineup, each read back",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      const requestId = await insertProving(setup, townsForSharpe);
      const before = await sideOf(setup, "team");

      const result = await runExecutorPass(sendingContextFor(setup));

      expect(result).toMatchObject({ kind: "completed", finalTenths: 0 });
      expect(postKinds(setup)).toEqual(["lineup", "adjustment", "adjustment", "lineup"]);
      expect(teamSideIn(setup, 1)).toEqual({
        teamId: TEAM,
        adjustment: (Math.round(before.adjustment * 10) + 1) / 10,
        adjustmentReason: PROVING_REASON_ENTRY,
      });
      expect(teamSideIn(setup, 2)).toEqual({
        teamId: TEAM,
        adjustment: before.adjustment,
        adjustmentReason: before.adjustmentReason ?? "",
      });
      expect(postedPlayers(setup, 3)).toEqual([SHARPE, TOWNS]);
      expect(lineupDayIn(setup, 3)).toBe(8);
      const outcomes = (await attemptsOf(setup, requestId)).map((each) => each.outcome);
      expect(outcomes).toEqual(Array(4).fill("verified"));
      expect((await detailOf(setup, requestId)).request).toMatchObject({
        status: "completed",
        lineupState: "pending",
        effectiveDay: null,
        adjustmentState: "not_owed",
        finalAdjustmentTenths: 0,
      });
      expect(await slotsOn(setup, 8, TOWNS, SHARPE)).toEqual(["C", "BE"]);
      expect(await slotsOn(setup, 13, TOWNS, SHARPE)).toEqual(["C", "BE"]);
      expect(await sideOf(setup, "team")).toMatchObject({
        adjustment: before.adjustment,
        adjustmentReason: before.adjustmentReason,
      });
    }
  );

  dbTest(
    "records team 1's side as read before the test adjustment goes out",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      const requestId = await insertProving(setup, townsForSharpe);
      const before = await sideOf(setup, "team");

      await runExecutorPass(sendingContextFor(setup));

      const types = (await detailOf(setup, requestId)).events.map((event) => event.eventType);
      const read = (await detailOf(setup, requestId)).events.find(
        (event) => event.eventType === "proving_side_read"
      );
      expect(read?.payload).toEqual({
        proving: "token",
        tenths: Math.round(before.adjustment * 10),
        reason: before.adjustmentReason ?? "",
      });
      expect(types.indexOf("proving_side_read")).toBeLessThan(types.indexOf("adjustment_sent"));
    }
  );

  dbTest(
    "restores a one-move rearrangement with its items reversed, all three players back",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      await insertProving(setup, lillardForEdey);

      const result = await runExecutorPass(sendingContextFor(setup));

      expect(result).toMatchObject({ kind: "completed" });
      expect(postedPlayers(setup, 0)).toEqual([LILLARD, UTIL_GUARD, EDEY]);
      expect(postedPlayers(setup, 3)).toEqual([EDEY, UTIL_GUARD, LILLARD]);
      expect(await slotsOn(setup, 8, LILLARD, UTIL_GUARD, EDEY)).toEqual(["G", "UTIL", "BE"]);
    }
  );

  dbTest(
    "keeps a real request's entry on the side through the run, the test note beside it",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      const reason = "Injury sub requested Tue 10/27, 7:10 PM PT: Larsson for Tatum, -40.4";
      await setSide(setup, "team", -404, reason);
      await insertProving(setup, townsForSharpe);

      await runExecutorPass(sendingContextFor(setup));

      expect(teamSideIn(setup, 2)).toMatchObject({
        adjustment: -40.3,
        adjustmentReason: `${reason} | ${PROVING_REASON_ENTRY}`,
      });
      expect(await sideOf(setup, "team")).toMatchObject({
        adjustment: -40.4,
        adjustmentReason: reason,
      });
    }
  );

  dbTest(
    "stops for the owner when ESPN's day changes before the restore, the swap still on ESPN",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      const requestId = await insertProving(setup, townsForSharpe);
      const espn = dayChangesAfter(setup, 3);

      const result = await runExecutorPass({ ...sendingContextFor(setup), espn });

      expect(result).toEqual({ kind: "sent_to_review", reason: "ambiguous" });
      expect(postKinds(setup)).toEqual(["lineup", "adjustment", "adjustment"]);
      const detail = await detailOf(setup, requestId);
      expect(detail.request).toMatchObject({ status: "needs_review", lineupState: "verified" });
      expect(detail.events.at(-1)?.payload).toMatchObject({
        proving: "restore",
        detail: "day_changed",
      });
      expect(await slotsOn(setup, 8, TOWNS, SHARPE)).toEqual(["BE", "C"]);
    }
  );

  dbTest(
    "never adds a substitution's adjustment to a proving run, while a real request still gets its own",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      await insertProving(setup, tatumForLarsson);

      await runExecutorPass(sendingContextFor(setup));

      expect(postKinds(setup)).toEqual(["lineup", "adjustment", "adjustment", "lineup"]);
      expect([teamSideIn(setup, 1).adjustment, teamSideIn(setup, 2).adjustment]).toEqual([0.1, 0]);
      expect(await slotsOn(setup, 8, TATUM, LARSSON)).toEqual(["F", "BE"]);

      await insertTatumRequest(setup);
      await runExecutorPass(sendingContextFor(setup));

      expect(teamSideIn(setup, 5).adjustment).toBe(-40.4);
    }
  );

  dbTest(
    "sends nothing when team 1's side still carries an earlier run's test note",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      await setSide(setup, "team", 1, PROVING_REASON_ENTRY);
      const requestId = await insertProving(setup, townsForSharpe);

      const result = await runExecutorPass(sendingContextFor(setup));

      expect(result).toEqual({ kind: "sent_to_review", reason: "adjustment_failed" });
      expect(postKinds(setup)).toEqual(["adjustment"]);
      const detail = await detailOf(setup, requestId);
      expect(detail.request.lineupState).toBe("pending");
      expect(detail.events.at(-1)?.payload).toMatchObject({
        proving: "before_swap",
        detail: "already_noted",
      });
    }
  );
});
