import { acquireWriteLease, type NewSubRequest, releaseWriteLease } from "@injurysub/db";
import { PROVING_REASON_ENTRY } from "@injurysub/domain";
import type { LineupRead } from "@injurysub/espn";
import { afterEach, beforeEach, describe, expect, vi } from "vitest";
import { dbTest } from "../test-support";
import { runExecutorPass } from "./executor";
import { runLineupStep } from "./lineup-step";
import type { ExecutorContext } from "./preflight";
import { runProvingRun } from "./proving";
import {
  attemptsOf,
  claimedAndStopped,
  claimForLineup,
  detailOf,
  EDEY,
  insertQueued,
  insertTatumRequest,
  LARSSON,
  LILLARD,
  lillardForEdey,
  outbox,
  postedPlayers,
  rehearsingContextFor,
  type Setup,
  SHARPE,
  sendingContextFor,
  sendThenStop,
  setSide,
  setUp,
  sideOf,
  slotsOn,
  TATUM,
  TEAM,
  TOWNS,
  takeTeamOffAllowlist,
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

// Runs `then` once, on the first matchup or lineup read after `afterPosts` writes reached the
// fake: a change on ESPN or in the league's settings between two of the run's steps. After the
// swap, the first such read is the token's; after the token, its readback's; after the revert,
// its readback's.
function onceAfter(
  setup: Setup,
  afterPosts: number,
  then: () => Promise<unknown> | unknown
): ExecutorContext["espn"] {
  let pending = true;
  const before = async () => {
    if (!pending || setup.fake.posts.length < afterPosts) return;
    pending = false;
    await then();
  };
  const { read } = setup.fake;
  return {
    ...read,
    getCurrentWeek: async () => {
      await before();
      return read.getCurrentWeek();
    },
    getLineup: async (teamId) => {
      await before();
      return read.getLineup(teamId);
    },
  };
}

// The latest event of a type: a test that ran several contexts has events whose clocks overlap.
async function latestEventOf(setup: Setup, requestId: string, type = "sent_to_review") {
  const { events } = await detailOf(setup, requestId);
  return events.findLast((event) => event.eventType === type)?.payload;
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
    "goes back in line with nothing sent when ESPN's day changes between the claim and the swap",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      const requestId = await insertProving(setup, townsForSharpe);
      let matchupReads = 0;
      // The run's first matchup read is its check before the swap: by then it is the next day.
      const espn: ExecutorContext["espn"] = {
        ...setup.fake.read,
        getCurrentWeek: async () => {
          const read = await setup.fake.read.getCurrentWeek();
          matchupReads += 1;
          if (matchupReads > 1) return read;
          return {
            ...read,
            meta: { ...read.meta, scoringPeriodId: read.meta.scoringPeriodId + 1 },
          };
        },
      };

      const result = await runExecutorPass({ ...sendingContextFor(setup), espn });

      expect(result).toEqual({ kind: "requeued" });
      expect(setup.fake.posts).toEqual([]);
      expect((await detailOf(setup, requestId)).request).toMatchObject({
        status: "queued",
        lineupState: "pending",
      });
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

describe("a proving run that can't be confirmed on ESPN", () => {
  dbTest(
    "stops at a test adjustment ESPN refused, sending neither the revert nor the restore",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      const requestId = await insertProving(setup, townsForSharpe);
      setup.fake.answerWrites("adjustment", "refuse");

      const result = await runExecutorPass(sendingContextFor(setup));

      expect(result).toEqual({ kind: "sent_to_review", reason: "adjustment_failed" });
      expect(postKinds(setup)).toEqual(["lineup", "adjustment"]);
      expect((await detailOf(setup, requestId)).request.lineupState).toBe("verified");
      expect(await latestEventOf(setup, requestId)).toMatchObject({
        proving: "token",
        detail: "not_applied",
      });
      expect(await outbox(setup)).toHaveLength(1);
    }
  );

  dbTest(
    "stops at a test adjustment ESPN answered 200 to but didn't apply",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      await insertProving(setup, townsForSharpe);
      setup.fake.answerWrites("adjustment", "ignore");

      const result = await runExecutorPass(sendingContextFor(setup));

      expect(result).toEqual({ kind: "sent_to_review", reason: "adjustment_failed" });
      expect(postKinds(setup)).toEqual(["lineup", "adjustment"]);
    }
  );

  dbTest(
    "goes on when the revert's answer was lost but ESPN shows it applied",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      await insertProving(setup, townsForSharpe);
      const espn = onceAfter(setup, 2, () => setup.fake.answerWrites("adjustment", "lose_answer"));

      const result = await runExecutorPass({ ...sendingContextFor(setup), espn });

      expect(result).toMatchObject({ kind: "completed" });
      expect(postKinds(setup)).toEqual(["lineup", "adjustment", "adjustment", "lineup"]);
    }
  );

  dbTest(
    "stops at a revert ESPN refused, keeping team 1's side as it was read to put back",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      const requestId = await insertProving(setup, townsForSharpe);
      const before = await sideOf(setup, "team");
      const espn = onceAfter(setup, 2, () => setup.fake.answerWrites("adjustment", "refuse"));

      const result = await runExecutorPass({ ...sendingContextFor(setup), espn });

      expect(result).toEqual({ kind: "sent_to_review", reason: "adjustment_failed" });
      expect(postKinds(setup)).toEqual(["lineup", "adjustment", "adjustment"]);
      expect(await latestEventOf(setup, requestId)).toMatchObject({
        proving: "revert",
        detail: "not_applied",
        original: {
          tenths: Math.round(before.adjustment * 10),
          reason: before.adjustmentReason ?? "",
        },
      });
    }
  );

  dbTest("stops at a restore ESPN didn't apply, the swap still on ESPN", async ({ database }) => {
    const setup = await setUp(database.connection);
    const requestId = await insertProving(setup, townsForSharpe);
    const espn = onceAfter(setup, 3, () => setup.fake.answerWrites("lineup", "ignore"));

    const result = await runExecutorPass({ ...sendingContextFor(setup), espn });

    expect(result).toEqual({ kind: "sent_to_review", reason: "ambiguous" });
    expect((await detailOf(setup, requestId)).request.lineupState).toBe("verified");
    expect(await latestEventOf(setup, requestId)).toMatchObject({
      proving: "restore",
      detail: "not_applied",
    });
  });

  dbTest(
    "stops at a restore ESPN applied only in part, the lineup unclear",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      const requestId = await insertProving(setup, townsForSharpe);
      const espn = onceAfter(setup, 3, () => setup.fake.skipLineupItems([0]));

      const result = await runExecutorPass({ ...sendingContextFor(setup), espn });

      expect(result).toEqual({ kind: "sent_to_review", reason: "ambiguous" });
      expect((await detailOf(setup, requestId)).request.lineupState).toBe("ambiguous");
    }
  );

  dbTest(
    "stops at a restore ESPN applied only from the next day, the swap's day still swapped",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      const requestId = await insertProving(setup, townsForSharpe);
      const espn = onceAfter(setup, 3, () => setup.fake.applyLineupFrom(9));

      const result = await runExecutorPass({ ...sendingContextFor(setup), espn });

      expect(result).toEqual({ kind: "sent_to_review", reason: "ambiguous" });
      expect((await detailOf(setup, requestId)).request.lineupState).toBe("verified");
      expect(await latestEventOf(setup, requestId)).toMatchObject({
        proving: "restore",
        detail: "day_changed",
      });
    }
  );

  dbTest(
    "stops before the token when the test note appeared on the side after the swap",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      const requestId = await insertProving(setup, townsForSharpe);
      const espn = onceAfter(setup, 1, () => setSide(setup, "team", 1, PROVING_REASON_ENTRY));

      const result = await runExecutorPass({ ...sendingContextFor(setup), espn });

      expect(result).toEqual({ kind: "sent_to_review", reason: "adjustment_failed" });
      expect(postKinds(setup)).toEqual(["lineup", "adjustment"]);
      expect(await latestEventOf(setup, requestId)).toMatchObject({
        proving: "token",
        detail: "already_noted",
      });
    }
  );

  dbTest(
    "stops, naming the token, when team 1 leaves the allowlist after the swap",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      const requestId = await insertProving(setup, townsForSharpe);
      const espn = onceAfter(setup, 1, () => takeTeamOffAllowlist(setup));

      const result = await runExecutorPass({ ...sendingContextFor(setup), espn });

      expect(result).toEqual({ kind: "sent_to_review", reason: "not_allowlisted" });
      expect(postKinds(setup)).toEqual(["lineup"]);
      expect(await latestEventOf(setup, requestId)).toMatchObject({ proving: "token" });
    }
  );

  dbTest("stops when ESPN can't be read after the swap", async ({ database }) => {
    const setup = await setUp(database.connection);
    const requestId = await insertProving(setup, townsForSharpe);
    const espn = onceAfter(setup, 1, () => setup.fake.failReads("espn_unavailable"));

    const result = await runExecutorPass({ ...sendingContextFor(setup), espn });

    expect(result).toEqual({ kind: "sent_to_review", reason: "ambiguous" });
    expect(postKinds(setup)).toEqual(["lineup"]);
    expect(await latestEventOf(setup, requestId)).toMatchObject({
      proving: "token",
      detail: "espn_unread",
    });
  });

  dbTest(
    "sends nothing more once another worker takes the lease over after the swap",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      const requestId = await insertProving(setup, townsForSharpe);
      const { lease, claimed } = await claimForLineup(setup, requestId);
      const { db } = setup.connection;
      const espn = onceAfter(setup, 1, async () => {
        await releaseWriteLease(db, lease);
        await acquireWriteLease(db, { holder: "another-worker", ttlSeconds: 60 });
      });
      const context = { ...sendingContextFor(setup), espn, lease, write: setup.fake.write };

      expect(await runProvingRun(context, claimed)).toEqual({ kind: "lost" });
      expect(postKinds(setup)).toEqual(["lineup"]);
    }
  );
});

describe("a proving run a restart interrupted", () => {
  dbTest(
    "stops, sending nothing, when the swap was read back before the restart",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      const requestId = await insertProving(setup, tatumForLarsson);
      const { lease, claimed } = await claimForLineup(setup, requestId);
      await runLineupStep({ ...sendingContextFor(setup), lease, write: setup.fake.write }, claimed);
      await releaseWriteLease(setup.connection.db, lease);

      const result = await runExecutorPass(sendingContextFor(setup));

      expect(result).toEqual({ kind: "sent_to_review", reason: "ambiguous" });
      expect(postKinds(setup)).toEqual(["lineup"]);
      expect(await latestEventOf(setup, requestId)).toMatchObject({ proving: "interrupted" });
    }
  );

  dbTest(
    "stops, sending nothing, when the swap was sent but its answer never recorded",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      const requestId = await insertProving(setup, tatumForLarsson);
      const { edit } = await claimedAndStopped(setup, requestId);
      await sendThenStop(setup, { requestId, kind: "lineup" }, (write, guard) =>
        write.applyLineup({ teamId: TEAM, scoringPeriodId: 8, moves: edit.items }, guard)
      );

      const result = await runExecutorPass(sendingContextFor(setup));

      expect(result).toEqual({ kind: "sent_to_review", reason: "ambiguous" });
      expect(postKinds(setup)).toEqual(["lineup"]);
      expect(await latestEventOf(setup, requestId)).toMatchObject({ proving: "interrupted" });
    }
  );

  dbTest("puts a run that sent nothing back in line", async ({ database }) => {
    const setup = await setUp(database.connection);
    const requestId = await insertProving(setup, townsForSharpe);
    await claimedAndStopped(setup, requestId);

    expect(await runExecutorPass(sendingContextFor(setup))).toEqual({ kind: "requeued" });
    expect((await detailOf(setup, requestId)).request.status).toBe("queued");
    expect(setup.fake.posts).toEqual([]);
  });
});

describe("a proving run with sending switched off", () => {
  dbTest(
    "records all four bodies, sends nothing and completes as a rehearsal",
    async ({ database }) => {
      const setup = await setUp(database.connection);
      const requestId = await insertProving(setup, townsForSharpe);
      const before = await sideOf(setup, "team");

      const result = await runExecutorPass(rehearsingContextFor(setup));

      expect(result).toMatchObject({ kind: "completed", finalTenths: 0 });
      expect(setup.fake.posts).toEqual([]);
      const attempts = await attemptsOf(setup, requestId);
      expect(attempts.map(({ kind, status }) => [kind, status])).toEqual([
        ["lineup", "recorded_only"],
        ["adjustment", "recorded_only"],
        ["adjustment", "recorded_only"],
        ["lineup", "recorded_only"],
      ]);
      const sideIn = (index: number) => {
        const [matchup] = attempts[index]?.body as ScheduleBody;
        return matchup.home.teamId === TEAM ? matchup.home : matchup.away;
      };
      expect(sideIn(1).adjustmentReason).toBe(PROVING_REASON_ENTRY);
      expect(sideIn(2).adjustment).toBe(before.adjustment);
      const restore = attempts[3]?.body as { items: { playerId: number }[] };
      expect(restore.items.map((item) => item.playerId)).toEqual([SHARPE, TOWNS]);
      expect((await detailOf(setup, requestId)).request).toMatchObject({
        status: "completed",
        isRehearsal: true,
        lineupState: "pending",
      });
      expect(await latestEventOf(setup, requestId, "completed")).toMatchObject({
        proving: true,
        rehearsal: true,
      });
    }
  );
});
