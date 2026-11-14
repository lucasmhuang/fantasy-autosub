import { randomUUID } from "node:crypto";
import {
  appendEvent,
  type DatabaseExecutor,
  espnWrites,
  markProvingDone,
  type NewSubRequest,
  writeLeagueSettings,
} from "@injurysub/db";
import { createEspnReadClient } from "@injurysub/espn";
import { describe, expect } from "vitest";
import { loadRequestDetail } from "./commish";
import { loadProvingPage, type ProvingPage, type ProvingRequestView } from "./proving";
import { editDigest } from "./requests";
import {
  insertInventedRequest,
  insertInventedUser,
  setWebEspn,
  type TeamWeekChange,
  webDbTest,
  withEligibleSlots,
} from "./test-support";

// Team 1 in the scenarios (day 8 of matchup 2): Damian Lillard at G; Jeremiah Fears, a guard on
// the bench, takes his G in a direct swap; Zach Edey, a center, takes a UTIL once the UTIL guard
// moves to G.
const LILLARD = 6606;
const FEARS = 5144091;
const EDEY = 4600663;
const UTIL_GUARD = 4900671;
// The UTIL guard able to play forward only: Edey then fits only once two other starters move.
const utilGuardForwardOnly = withEligibleSlots(UTIL_GUARD, ["SF", "F", "UTIL", "BE", "IR"]);

const swap = [
  { playerId: LILLARD, fromSlot: "G", toSlot: "BE" },
  { playerId: FEARS, fromSlot: "BE", toSlot: "G" },
];
// The names the request snapshot keeps, from the lineup ESPN showed at filing.
const filedLineup = {
  lineup: {
    starters: [{ slot: "G", player: { playerId: LILLARD, name: "Damian Lillard" } }],
    bench: [{ slot: "BE", player: { playerId: FEARS, name: "Jeremiah Fears" } }],
    injuredReserve: [],
  },
};
const sideRead = { tenths: -353, reason: "Injury sub requested Tue: Larsson for Tatum, -40.4" };

type Attempt = { kind: "lineup" | "adjustment"; status: string; outcome?: string };
type Run = {
  request: Partial<NewSubRequest>;
  events?: [string, Record<string, unknown>][];
  attempts?: Attempt[];
};

function scripted(change?: TeamWeekChange, sendMode: "live" | "never" = "live") {
  setWebEspn(
    createEspnReadClient({ mode: "scripted", scenario: "one-out-starter" }),
    change,
    sendMode
  );
}

async function asCommissioner(db: DatabaseExecutor) {
  const userId = await insertInventedUser(db, { role: "commissioner", teamId: 1 });
  await writeLeagueSettings(db, {
    executionMode: "approval_required",
    writeAllowlist: [1],
    updatedBy: userId,
    now: new Date(),
    shownUpdatedAt: null,
  });
  return userId;
}

// A proving request for Lillard and Fears as a run left it: its events, a moment apart, and its
// ESPN writes in the order sent.
async function insertRun(db: DatabaseExecutor, run: Run): Promise<string> {
  const requestId = await insertInventedRequest(
    db,
    {
      kind: "proving",
      designationAtRequest: "ACTIVE",
      projectedAdjustmentTenths: null,
      ...run.request,
    },
    filedLineup
  );
  const start = Date.parse("2026-10-28T02:00:00Z");
  for (const [index, [eventType, payload]] of (run.events ?? []).entries()) {
    const event = { eventId: randomUUID(), actorType: "system" as const, actorUserId: null };
    const createdAt = new Date(start + index * 1000);
    await appendEvent(db, requestId, { ...event, eventType, payload, createdAt });
  }
  for (const [index, attempt] of (run.attempts ?? []).entries()) {
    await db.insert(espnWrites).values({
      writeId: randomUUID(),
      requestId,
      kind: attempt.kind,
      teamId: 1,
      body: {},
      fencingToken: 1,
      status: attempt.status as "answered",
      outcome: (attempt.outcome ?? null) as "verified" | null,
      sentAt: new Date(start + index * 1000),
    });
  }
  return requestId;
}

const claimed: [string, Record<string, unknown>] = ["claimed", { items: swap, movedStarters: 0 }];
const sideReadEvent: [string, Record<string, unknown>] = [
  "proving_side_read",
  { proving: "token", ...sideRead },
];
const stoppedAt = (step: string, detail: string): [string, Record<string, unknown>] => [
  "sent_to_review",
  { reason: "adjustment_failed", proving: step, detail },
];
const stoppedRun = { status: "needs_review" as const, lineupState: "verified" as const };

function pageOf(page: ProvingPage): Extract<ProvingPage, { status: "found" }> {
  if (page.status !== "found") throw new Error(`expected the proving page, got ${page.status}`);
  return page;
}

async function viewOf(requestId: string): Promise<ProvingRequestView> {
  const page = pageOf(await loadProvingPage({ starterId: null }));
  const view = page.requests.find((each) => each.requestId === requestId);
  if (view === undefined) throw new Error(`request ${requestId} isn't on the proving page`);
  return view;
}

describe("loadProvingPage: what can be filed", () => {
  webDbTest(
    "offers each bench player the app can send for the chosen starter, marking the one-move ones",
    async ({ database }) => {
      await asCommissioner(database.connection.db);
      scripted();

      const { choices } = pageOf(await loadProvingPage({ starterId: LILLARD }));

      if (choices?.status !== "found") throw new Error("expected choices");
      expect(choices.chosen).toBe(LILLARD);
      expect(choices.starters.map((each) => each.playerId)).toContain(LILLARD);
      expect(choices.options.find((option) => option.playerId === FEARS)).toMatchObject({
        kind: "direct_swap",
        digest: editDigest(swap),
      });
      expect(choices.options.find((option) => option.playerId === EDEY)).toMatchObject({
        kind: "one_move",
        moves: [
          { name: "Damian Lillard", fromSlot: "G", toSlot: "BE" },
          { name: expect.any(String), fromSlot: "UTIL", toSlot: "G" },
          { name: "Zach Edey", fromSlot: "BE", toSlot: "UTIL" },
        ],
      });
    }
  );

  webDbTest(
    "leaves out a bench player who fits only if two other starters move",
    async ({ database }) => {
      await asCommissioner(database.connection.db);
      scripted(utilGuardForwardOnly);

      const { choices } = pageOf(await loadProvingPage({ starterId: LILLARD }));

      if (choices?.status !== "found") throw new Error("expected choices");
      expect(choices.options.map((option) => option.playerId)).toContain(FEARS);
      expect(choices.options.map((option) => option.playerId)).not.toContain(EDEY);
    }
  );

  webDbTest("offers nothing to file once proving is marked done", async ({ database }) => {
    const { db } = database.connection;
    const userId = await asCommissioner(db);
    scripted();
    const doneAt = new Date("2026-11-14T02:00:00Z");
    await markProvingDone(db, { updatedBy: userId, now: doneAt });

    const page = pageOf(await loadProvingPage({ starterId: LILLARD }));

    expect(page.choices).toBeNull();
    expect(page.provingDoneAt).toEqual(doneAt);
  });
});

describe("loadProvingPage: a stopped run", () => {
  webDbTest(
    "shows a run stopped at the revert with the swap reversed and team 1's side as it was read",
    async ({ database }) => {
      const { db } = database.connection;
      await asCommissioner(db);
      scripted();
      const requestId = await insertRun(db, {
        request: stoppedRun,
        events: [claimed, sideReadEvent, stoppedAt("revert", "not_applied")],
        attempts: [
          { kind: "lineup", status: "answered", outcome: "verified" },
          { kind: "adjustment", status: "answered", outcome: "verified" },
          { kind: "adjustment", status: "failed", outcome: "not_applied" },
        ],
      });

      const { stopped, putBack, cancel } = await viewOf(requestId);

      expect(stopped).toEqual({
        step: "revert",
        detail: "not_applied",
        restoreMoves: [
          { name: "Jeremiah Fears", fromSlot: "G", toSlot: "BE" },
          { name: "Damian Lillard", fromSlot: "BE", toSlot: "G" },
        ],
        sideToRestore: sideRead,
        earlierDayKeepsSwap: false,
      });
      expect([putBack, cancel]).toEqual([true, false]);
    }
  );

  webDbTest(
    "shows the side to check whenever a test adjustment went out and no revert read back",
    async ({ database }) => {
      const { db } = database.connection;
      await asCommissioner(db);
      scripted();
      const atToken = await insertRun(db, {
        request: stoppedRun,
        events: [claimed, sideReadEvent, stoppedAt("token", "not_applied")],
        attempts: [
          { kind: "lineup", status: "answered", outcome: "verified" },
          { kind: "adjustment", status: "failed", outcome: "not_applied" },
        ],
      });
      const interrupted = await insertRun(db, {
        request: { ...stoppedRun, injuredPlayerId: 3 },
        events: [claimed, sideReadEvent, stoppedAt("interrupted", "restarted")],
        attempts: [
          { kind: "lineup", status: "answered", outcome: "verified" },
          { kind: "adjustment", status: "sending" },
        ],
      });

      expect((await viewOf(atToken)).stopped?.sideToRestore).toEqual(sideRead);
      expect((await viewOf(interrupted)).stopped?.sideToRestore).toEqual(sideRead);
    }
  );

  webDbTest(
    "shows no side when no test adjustment went out, or once the revert read back",
    async ({ database }) => {
      const { db } = database.connection;
      await asCommissioner(db);
      scripted();
      // Team 1 left the allowlist after the side was read, so the test adjustment never went out.
      const beforeToken = await insertRun(db, {
        request: stoppedRun,
        events: [claimed, sideReadEvent, stoppedAt("token", "not_allowlisted")],
        attempts: [{ kind: "lineup", status: "answered", outcome: "verified" }],
      });
      const atRestore = await insertRun(db, {
        request: { ...stoppedRun, injuredPlayerId: 3 },
        events: [claimed, sideReadEvent, stoppedAt("restore", "not_applied")],
        attempts: [
          { kind: "lineup", status: "answered", outcome: "verified" },
          { kind: "adjustment", status: "answered", outcome: "verified" },
          { kind: "adjustment", status: "answered", outcome: "verified" },
          { kind: "lineup", status: "answered", outcome: "not_applied" },
        ],
      });

      for (const requestId of [beforeToken, atRestore]) {
        const { stopped } = await viewOf(requestId);
        expect(stopped?.sideToRestore).toBeNull();
        expect(stopped?.restoreMoves).toHaveLength(2);
      }
    }
  );

  webDbTest("says the swap's day keeps the swap once ESPN's day changed", async ({ database }) => {
    const { db } = database.connection;
    await asCommissioner(db);
    scripted();
    const requestId = await insertRun(db, {
      request: stoppedRun,
      events: [claimed, sideReadEvent, stoppedAt("restore", "day_changed")],
      attempts: [{ kind: "lineup", status: "answered", outcome: "verified" }],
    });

    expect((await viewOf(requestId)).stopped?.earlierDayKeepsSwap).toBe(true);
  });

  webDbTest(
    "offers Cancel, and no way to close it as put back, for one in review with nothing on ESPN",
    async ({ database }) => {
      const { db } = database.connection;
      await asCommissioner(db);
      scripted();
      const requestId = await insertRun(db, {
        request: { status: "needs_review", reviewReason: "stale", lineupState: "pending" },
      });

      const { cancel, putBack, stopped } = await viewOf(requestId);

      expect([cancel, putBack]).toEqual([true, false]);
      expect(stopped?.restoreMoves).toBeNull();
    }
  );
});

describe("loadProvingPage: the runs", () => {
  webDbTest(
    "offers Approve with the test amount, and Cancel, while one waits for approval",
    async ({ database }) => {
      const { db } = database.connection;
      await asCommissioner(db);
      scripted();
      const requestId = await insertRun(db, {
        request: { status: "awaiting_approval", reviewReason: null },
      });

      const view = await viewOf(requestId);

      expect(view).toMatchObject({ approve: { shownTenths: 1 }, cancel: true, putBack: false });
      expect(view.stopped).toBeNull();
    }
  );

  webDbTest(
    "shows a completed run's four writes in order, each with what ESPN showed",
    async ({ database }) => {
      const { db } = database.connection;
      await asCommissioner(db);
      scripted();
      const verified = { status: "answered", outcome: "verified" };
      const requestId = await insertRun(db, {
        request: { status: "completed", reviewReason: null },
        attempts: [
          { kind: "lineup", ...verified },
          { kind: "adjustment", ...verified },
          { kind: "adjustment", ...verified },
          { kind: "lineup", ...verified },
        ],
      });

      const { writes } = await viewOf(requestId);

      expect(writes.map(({ step, outcome }) => [step, outcome])).toEqual([
        ["swap", "verified"],
        ["token", "verified"],
        ["revert", "verified"],
        ["restore", "verified"],
      ]);
    }
  );

  webDbTest(
    "reads a rehearsed run as a rehearsal from its own record, whatever the worker sends now",
    async ({ database }) => {
      const { db } = database.connection;
      await asCommissioner(db);
      scripted(undefined, "live");
      const rehearsed = await insertRun(db, {
        request: { status: "completed", reviewReason: null, isRehearsal: true },
      });
      const live = await insertRun(db, {
        request: { status: "completed", reviewReason: null, injuredPlayerId: 3 },
      });

      const page = pageOf(await loadProvingPage({ starterId: null }));

      expect(page.rehearsal).toBe(false);
      expect((await viewOf(rehearsed)).rehearsal).toBe(true);
      expect((await viewOf(live)).rehearsal).toBe(false);
    }
  );
});

describe("loadRequestDetail: a proving request", () => {
  webDbTest("answers that it is a proving request, shown on its own page", async ({ database }) => {
    const { db } = database.connection;
    await asCommissioner(db);
    scripted();
    const requestId = await insertRun(db, { request: { status: "awaiting_approval" } });

    expect(await loadRequestDetail({ requestId })).toEqual({ status: "proving" });
  });
});
