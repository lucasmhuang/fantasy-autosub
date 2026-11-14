import { randomUUID } from "node:crypto";
import { appendEvent, espnWrites, getEspnAccess, getMisuseWatch } from "@injurysub/db";
import { EspnError } from "@injurysub/espn";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbTest } from "../test-support";
import { detectionTasks, runDetectionPass } from "./detection";
import {
  alertsOf,
  type DetectionSetup,
  emailsSent,
  insertRequest,
  lmEdit,
  minutesFrom,
  now,
  setUpDetection,
} from "./test-support";

// Team 2 (ESPN's "Team 2" in the recordings) on the recorded day 8: its center to the bench,
// a bench player into C.
const CENTER = 3032977;
const BENCH = 4278585;
const SLOT = { C: 4, BE: 12, UTIL: 11 };
const centerOut = { playerId: CENTER, fromSlotId: SLOT.C, toSlotId: SLOT.BE };
const swapItems = [centerOut, { playerId: BENCH, fromSlotId: SLOT.BE, toSlotId: SLOT.C }];
const swapPlan = [
  { playerId: CENTER, fromSlot: "C", toSlot: "BE" },
  { playerId: BENCH, fromSlot: "BE", toSlot: "C" },
];

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function insertSentWrite(
  setup: DetectionSetup,
  sentAt: Date,
  body: unknown,
  kind: "lineup" | "adjustment"
) {
  const requestId = await insertRequest(setup, {});
  await setup.connection.db.insert(espnWrites).values({
    writeId: randomUUID(),
    requestId,
    kind,
    teamId: 2,
    matchupId: 8,
    scoringPeriodId: 8,
    body,
    fencingToken: 1,
    status: "answered",
    sentAt,
  });
}

describe("misuse detection, league-manager edits", () => {
  dbTest(
    "alerts once for an edit the app didn't make, with its undo, the team as ESPN names it, and one email",
    async ({ database }) => {
      const setup = await setUpDetection(database.connection);
      setup.monitor.transactions.push(lmEdit(2, minutesFrom(now, -3), swapItems));

      await runDetectionPass(setup.context());
      await runDetectionPass(setup.context(minutesFrom(now, 5)));

      const { open } = await alertsOf(setup);
      expect(open).toHaveLength(1);
      expect(open[0]).toMatchObject({ kind: "lm_transaction", teamId: 2, teamName: "Team 2" });
      expect(open[0]?.details).toMatchObject({
        undo: [
          expect.stringMatching(/from C to BE|from BE to C/),
          expect.stringMatching(/from C to BE|from BE to C/),
        ],
      });
      const emails = await emailsSent(setup);
      expect(emails).toHaveLength(1);
      expect(emails[0]?.subject).toBe("InjurySub: check a league-manager action on Team 2");
      expect(emails[0]?.body).toMatch(/ESPN's time: .* PT/);
    }
  );

  dbTest("never alerts for the app's own write (M2)", async ({ database }) => {
    const setup = await setUpDetection(database.connection);
    const sentAt = minutesFrom(now, -3);
    await insertSentWrite(
      setup,
      sentAt,
      {
        teamId: 2,
        scoringPeriodId: 8,
        items: swapItems.map(({ playerId, fromSlotId, toSlotId }) => ({
          playerId,
          type: "LINEUP",
          fromLineupSlotId: fromSlotId,
          toLineupSlotId: toSlotId,
        })),
      },
      "lineup"
    );
    setup.monitor.transactions.push(lmEdit(2, minutesFrom(sentAt, 0.1), swapItems));

    await runDetectionPass(setup.context());

    expect((await alertsOf(setup)).open).toEqual([]);
    expect(await emailsSent(setup)).toEqual([]);
  });

  // ESPN logs an upheld trade with no items (the live league, 2026-11-14).
  dbTest(
    "alerts for a league-manager record without items, naming its type and team",
    async ({ database }) => {
      const setup = await setUpDetection(database.connection);
      const upheld = { type: "TRADE_UPHOLD", items: [] };
      setup.monitor.transactions.push(lmEdit(5, minutesFrom(now, -3), [], upheld));

      await runDetectionPass(setup.context());

      const { open } = await alertsOf(setup);
      expect(open.map((alert) => alert.details)).toEqual([
        expect.objectContaining({
          what: "A league-manager TRADE_UPHOLD InjurySub didn't make on Team 5.",
          undo: [
            "Look it up in ESPN's league activity, and reverse it there if you didn't make it.",
          ],
        }),
      ]);
      expect(await emailsSent(setup)).toHaveLength(1);
    }
  );

  dbTest("never alerts for managers' own moves (M3)", async ({ database }) => {
    const setup = await setUpDetection(database.connection);
    setup.monitor.transactions.push(
      lmEdit(2, minutesFrom(now, -3), swapItems, { byLeagueManager: false }),
      lmEdit(3, minutesFrom(now, -2), [], { type: "WAIVER", byLeagueManager: false })
    );

    await runDetectionPass(setup.context());

    expect((await alertsOf(setup)).open).toEqual([]);
  });

  // Dec-D31a.
  dbTest(
    "acknowledges an edit exactly matching a by-hand completion, naming it, with no email",
    async ({ database }) => {
      const setup = await setUpDetection(database.connection);
      const requestId = await insertRequest(setup, { status: "completed_manually" }, swapPlan);
      await appendEvent(setup.connection.db, requestId, {
        eventId: randomUUID(),
        actorType: "commissioner",
        actorUserId: setup.commissioner,
        eventType: "completed_manually",
        payload: {},
        createdAt: minutesFrom(now, -2),
      });
      setup.monitor.transactions.push(lmEdit(2, minutesFrom(now, -4), swapItems));

      await runDetectionPass(setup.context());

      const { open, acknowledged } = await alertsOf(setup);
      expect(open).toEqual([]);
      expect(acknowledged).toMatchObject([{ matchedRequestId: requestId, acknowledgedBy: null }]);
      expect(acknowledged[0]?.acknowledgedNote).toMatch(/^Matches your by-hand completion of /);
      expect(await emailsSent(setup)).toEqual([]);
    }
  );

  dbTest(
    "alerts for an edit differing from a by-hand completion in any slot",
    async ({ database }) => {
      const setup = await setUpDetection(database.connection);
      const requestId = await insertRequest(setup, { status: "completed_manually" }, swapPlan);
      await appendEvent(setup.connection.db, requestId, {
        eventId: randomUUID(),
        actorType: "commissioner",
        actorUserId: setup.commissioner,
        eventType: "completed_manually",
        payload: {},
        createdAt: minutesFrom(now, -2),
      });
      const otherSlot = [centerOut, { playerId: BENCH, fromSlotId: SLOT.BE, toSlotId: SLOT.UTIL }];
      setup.monitor.transactions.push(lmEdit(2, minutesFrom(now, -4), otherSlot));

      await runDetectionPass(setup.context());

      expect((await alertsOf(setup)).open).toMatchObject([
        { kind: "lm_transaction", matchedRequestId: null },
      ]);
      expect(await emailsSent(setup)).toHaveLength(1);
    }
  );

  // The commissioner edits ESPN, then marks the request done: the edit waits out the match window
  // rather than alerting in between.
  dbTest(
    "waits on an edit while its team's request is with the commissioner, alerting once the window passes",
    async ({ database }) => {
      const setup = await setUpDetection(database.connection);
      await insertRequest(
        setup,
        { status: "needs_review", reviewReason: "rearrangement" },
        swapPlan
      );
      setup.monitor.transactions.push(lmEdit(2, minutesFrom(now, -3), swapItems));

      await runDetectionPass(setup.context());
      expect((await alertsOf(setup)).open).toEqual([]);
      await runDetectionPass(setup.context(minutesFrom(now, 20)));

      expect((await alertsOf(setup)).open).toMatchObject([{ kind: "lm_transaction", teamId: 2 }]);
    }
  );

  // OQ18, Dec-D15: on ESPN before the watch began, listed once for acknowledgement, never emailed.
  dbTest(
    "lists earlier actions on its first run, the owner's 2026-11-03 edit already acknowledged",
    async ({ database }) => {
      const setup = await setUpDetection(database.connection, { firstRun: true });
      const ownerEdit = lmEdit(1, new Date("2026-11-03T00:43:10.000Z"), swapItems);
      setup.monitor.transactions.push(
        { ...ownerEdit, scoringPeriodId: 8 },
        lmEdit(2, minutesFrom(now, -600), swapItems)
      );

      await runDetectionPass(setup.context());

      const { open, acknowledged } = await alertsOf(setup);
      expect(open).toMatchObject([{ teamId: 2, foundBeforeWatch: true }]);
      expect(acknowledged).toMatchObject([{ teamId: 1, foundBeforeWatch: true }]);
      expect(acknowledged[0]?.acknowledgedNote).toMatch(/owner/);
      expect(await emailsSent(setup)).toEqual([]);
      expect(await getMisuseWatch(setup.connection.db)).toMatchObject({
        state: "working",
        firstRunAt: now,
        scannedThroughDay: 8,
      });
    }
  );
});

// D16, M9: the commissioner's own path on their team raises no alert, so they skim its last day.
describe("misuse detection, the commissioner team's moves", () => {
  dbTest(
    "keeps the commissioner team's moves of the last day, by name, whoever made them",
    async ({ database }) => {
      const setup = await setUpDetection(database.connection);
      setup.monitor.transactions.push(
        lmEdit(1, minutesFrom(now, -120), [centerOut], { byLeagueManager: false }),
        lmEdit(1, minutesFrom(now, -25 * 60), [centerOut], { scoringPeriodId: 7 }),
        lmEdit(2, minutesFrom(now, -60), [centerOut], { byLeagueManager: false })
      );

      await runDetectionPass(setup.context());

      const watch = await getMisuseWatch(setup.connection.db);
      expect(watch?.teamMoves).toEqual([
        {
          at: minutesFrom(now, -120).toISOString(),
          type: "ROSTER",
          byLeagueManager: false,
          items: [
            {
              type: "LINEUP",
              player: expect.not.stringMatching(/^player /),
              fromSlot: "C",
              toSlot: "BE",
            },
          ],
        },
      ]);
    }
  );
});

describe("misuse detection, adjustments and the league", () => {
  dbTest(
    "alerts for an adjustment the app didn't write, and not for its own",
    async ({ database }) => {
      const setup = await setUpDetection(database.connection);
      const reason = "Injury sub requested Tue, 10/27, 11:00 AM PT: A for B, +5.1";
      await insertSentWrite(
        setup,
        minutesFrom(now, -3),
        [
          {
            id: 8,
            home: { teamId: 7, adjustment: 0, adjustmentReason: "" },
            away: { teamId: 2, adjustment: 5.1, adjustmentReason: reason },
          },
        ],
        "adjustment"
      );
      const base = { matchupId: 8, opponentTeamId: 7, totalBefore: 100, totalAfter: 105.1 };
      setup.monitor.adjustments.push(
        { ...base, messageId: "m-own", at: minutesFrom(now, -3), teamId: 2, reason },
        {
          ...base,
          messageId: "m-other",
          at: minutesFrom(now, -1),
          teamId: 2,
          reason: "Bonus",
          totalAfter: 110,
        }
      );

      await runDetectionPass(setup.context());

      const { open } = await alertsOf(setup);
      expect(open).toMatchObject([{ kind: "lm_adjustment", teamId: 2, teamName: "Team 2" }]);
      expect(String((open[0]?.details as { undo: string[] }).undo)).toMatch(/-10\.0/);
    }
  );

  // M7: the backstop whatever the logs show. Team 2's settled request applied -40.4; ESPN shows 0.
  dbTest(
    "alerts when a side's adjustment differs from the app's records, with both",
    async ({ database }) => {
      const setup = await setUpDetection(database.connection);
      await insertRequest(setup, { matchupId: 8, finalAdjustmentTenths: -404 });

      await runDetectionPass(setup.context());

      const { open } = await alertsOf(setup);
      expect(open).toMatchObject([
        {
          kind: "adjustment_mismatch",
          teamId: 2,
          details: expect.objectContaining({ expectedTenths: -404, actualTenths: 0 }),
        },
      ]);
    }
  );

  dbTest(
    "alerts once the league is public, and for another league-manager change",
    async ({ database }) => {
      const setup = await setUpDetection(database.connection);
      setup.monitor.isPublic = true;
      setup.monitor.leagueChanges.push({
        messageId: "m-settings",
        at: minutesFrom(now, -2),
        topicType: "ACTIVITY_SETTINGS",
        messageTypeId: 154,
      });

      await runDetectionPass(setup.context());
      await runDetectionPass(setup.context(minutesFrom(now, 5)));

      const { open } = await alertsOf(setup);
      expect(open.map((alert) => alert.kind).sort()).toEqual(["league_public", "lm_league_change"]);
      expect(await emailsSent(setup)).toHaveLength(2);
    }
  );
});

describe("misuse detection, paused", () => {
  // Dec-D32c: a refused cookie sends the credentials email alone, whichever loop sees it first.
  dbTest(
    "shows detection paused on a refused cookie, with the one credentials email and no pause email",
    async ({ database }) => {
      const setup = await setUpDetection(database.connection);
      setup.monitor.failWith = "credentials_rejected";

      await runDetectionPass(setup.context());
      await runDetectionPass(setup.context(minutesFrom(now, 5)));

      expect(await getMisuseWatch(setup.connection.db)).toMatchObject({
        state: "credentials_rejected",
      });
      expect(await getEspnAccess(setup.connection.db)).toMatchObject({
        state: "credentials_rejected",
      });
      const emails = await emailsSent(setup);
      expect(emails.map((email) => email.subject)).toEqual(["InjurySub: ESPN refused the cookie"]);
      expect(emails[0]?.body).toContain("Misuse watch: paused until ESPN accepts a new cookie.");
    }
  );

  dbTest(
    "emails once that detection is paused while ESPN can't be reached (M6)",
    async ({ database }) => {
      const setup = await setUpDetection(database.connection);
      setup.monitor.failWith = "espn_unavailable";

      const result = await runDetectionPass(setup.context());
      await runDetectionPass(setup.context(minutesFrom(now, 5)));

      expect(result).toEqual({ kind: "paused", code: "espn_unavailable" });
      expect(await getMisuseWatch(setup.connection.db)).toMatchObject({
        state: "unreachable",
        since: now,
        scannedThroughDay: 8,
      });
      expect((await emailsSent(setup)).map((email) => email.subject)).toEqual([
        "InjurySub: the misuse watch is paused",
      ]);
    }
  );

  dbTest("pauses when the week can't be read, too", async ({ database }) => {
    const setup = await setUpDetection(database.connection);
    const context = setup.context();
    const refusing = {
      ...context,
      espn: {
        ...context.espn,
        getCurrentWeek: async () => {
          throw new EspnError("espn_unavailable", "invented outage");
        },
      },
    };

    expect(await runDetectionPass(refusing)).toEqual({ kind: "paused", code: "espn_unavailable" });
  });
});

describe("detectionTasks", () => {
  it("watches only a league read live, where the cookie is the real league's", () => {
    const run = async () => {};

    expect(detectionTasks({ mode: "live", run })).toEqual([{ name: "misuse_watch", run }]);
    for (const mode of ["stub", "scripted", "none"] as const) {
      expect(detectionTasks({ mode, run })).toEqual([]);
    }
  });
});
