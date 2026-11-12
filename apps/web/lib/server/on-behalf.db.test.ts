import { randomUUID } from "node:crypto";
import {
  type DatabaseExecutor,
  subRequestSnapshots,
  subRequests,
  writeLeagueSettings,
} from "@injurysub/db";
import { createEspnReadClient } from "@injurysub/espn";
import { describe, expect } from "vitest";
import { loadRequestDetail } from "./commish";
import { actOnRequest } from "./commish-actions";
import { fileOnBehalfRequest, loadFilingChoices } from "./on-behalf";
import { insertInventedUser, setWebEspn, type TeamWeekChange, webDbTest } from "./test-support";

// Team 1 in the scenarios: Damian Lillard (6606) is OUT; Day'Ron Sharpe (4432194), a bench
// center, plays on day 8 (2026-10-27), tipping at 23:30Z (4:30 PM PDT). Filing happens at 8 PM
// PDT that day, on ESPN's day 8.
const LILLARD = 6606;
const SHARPE = 4432194;
const now = new Date("2026-10-28T03:00:00Z");

const line = (fantasyPoints: number) => ({
  fantasyPoints,
  points: 0,
  rebounds: 0,
  assists: 0,
  steals: 0,
  blocks: 0,
  turnovers: 0,
});

// Sharpe also played on day 7 (tip 2026-10-26T23:00Z, 4 PM PDT), finishing with 12.4.
const sharpeOnDay7: TeamWeekChange = (read) => ({
  ...read,
  players: read.players.map((player) =>
    player.playerId !== SHARPE
      ? player
      : {
          ...player,
          weekGames: [
            {
              scoringPeriodId: 7,
              date: "2026-10-26T23:00:00.000Z",
              opponentProTeamId: 2,
              opponent: "BOS",
              home: true,
            },
            ...player.weekGames,
          ],
        }
  ),
  days: read.days.map((day) =>
    day.scoringPeriodId !== 7
      ? day
      : {
          ...day,
          players: day.players.map((player) =>
            player.playerId === SHARPE ? { ...player, line: line(12.4) } : player
          ),
        }
  ),
});

function scripted(change?: TeamWeekChange): void {
  setWebEspn(createEspnReadClient({ mode: "scripted", scenario: "one-out-starter" }), change);
}

async function commissioner(db: DatabaseExecutor, teamId: number | null = null) {
  const userId = await insertInventedUser(db, { role: "commissioner", teamId });
  return { userId, role: "commissioner" as const, teamId };
}

function filing(fields: Record<string, string>): FormData {
  const form = new FormData();
  const all = {
    team: "1",
    injured: String(LILLARD),
    replacement: String(SHARPE),
    designation: "OUT",
    idempotencyKey: randomUUID(),
    ...fields,
  };
  for (const [name, value] of Object.entries(all)) form.set(name, value);
  return form;
}

describe("fileOnBehalfRequest", () => {
  webDbTest(
    "accepts a moment before the replacement's tip, keeping the attested and the filing designations",
    async ({ database }) => {
      const { db } = database.connection;
      scripted();
      const user = await commissioner(db);

      const result = await fileOnBehalfRequest({
        user,
        form: filing({ moment: "2026-10-27T15:00", replacementGame: "not_started" }),
        now,
      });

      expect(result.status).toBe("recorded");
      expect(await db.select().from(subRequests)).toMatchObject([
        {
          kind: "on_behalf",
          teamId: 1,
          requestedBy: user.userId,
          requestMoment: new Date("2026-10-27T22:00:00Z"),
          filedAt: now,
          requestDay: 8,
          designationAtRequest: "OUT",
          designationAtFiling: "OUT",
          attestedFields: ["designation", "replacement_game"],
          replacementPointsAtRequestTenths: 0,
          snapshotSource: "observed",
        },
      ]);
      const [snapshot] = await db.select().from(subRequestSnapshots);
      expect(snapshot).toMatchObject({ takenAt: now, payload: { taken: "at_filing" } });
    }
  );

  webDbTest(
    "refuses a moment after the replacement's tip attested as before it",
    async ({ database }) => {
      const { db } = database.connection;
      scripted();

      const result = await fileOnBehalfRequest({
        user: await commissioner(db),
        form: filing({ moment: "2026-10-27T17:00", replacementGame: "not_started" }),
        now,
      });

      expect(result).toMatchObject({ status: "refused", reason: "game_had_started" });
    }
  );

  webDbTest(
    "refuses hand-entered points while the replacement's day is still going",
    async ({ database }) => {
      const { db } = database.connection;
      scripted();

      const result = await fileOnBehalfRequest({
        user: await commissioner(db),
        form: filing({
          moment: "2026-10-27T17:00",
          replacementGame: "in_progress",
          enteredPoints: "3.0",
          note: "Screenshot from the group chat.",
        }),
        now,
      });

      expect(result).toMatchObject({ status: "refused", reason: "hand_entry_needs_final_line" });
    }
  );

  webDbTest(
    "accepts hand-entered points within his final line once the day is final",
    async ({ database }) => {
      const { db } = database.connection;
      scripted(sharpeOnDay7);

      const result = await fileOnBehalfRequest({
        user: await commissioner(db),
        form: filing({
          moment: "2026-10-26T17:00",
          replacementGame: "in_progress",
          enteredPoints: "5.0",
          note: "Screenshot from the group chat.",
        }),
        now,
      });

      expect(result.status).toBe("recorded");
      expect(await db.select().from(subRequests)).toMatchObject([
        {
          requestDay: 7,
          replacementPointsAtRequestTenths: 50,
          snapshotSource: "entered_by_hand",
          attestedFields: ["designation", "replacement_game", "points_at_request"],
        },
      ]);
    }
  );

  webDbTest("refuses hand-entered points above his final line", async ({ database }) => {
    const { db } = database.connection;
    scripted(sharpeOnDay7);

    const result = await fileOnBehalfRequest({
      user: await commissioner(db),
      form: filing({
        moment: "2026-10-26T17:00",
        replacementGame: "in_progress",
        enteredPoints: "13.0",
        note: "Screenshot from the group chat.",
      }),
      now,
    });

    expect(result).toMatchObject({ status: "refused", reason: "hand_entry_out_of_range" });
  });

  webDbTest("refuses a filing for the commissioner's own team", async ({ database }) => {
    const { db } = database.connection;
    scripted();

    const result = await fileOnBehalfRequest({
      user: await commissioner(db, 1),
      form: filing({ moment: "2026-10-27T15:00", replacementGame: "not_started" }),
      now,
    });

    expect(result).toMatchObject({ status: "refused", reason: "own_team_on_behalf" });
  });

  webDbTest(
    "counts a waiting request's expiry from its filing, not from a moment 13 hours before",
    async ({ database }) => {
      const { db } = database.connection;
      scripted();
      const user = await commissioner(db);
      await writeLeagueSettings(db, {
        executionMode: "approval_required",
        writeAllowlist: [1],
        updatedBy: user.userId,
        now,
      });

      const result = await fileOnBehalfRequest({
        user,
        // Fears (5144091), a bench guard, takes Lillard's slot directly; no game on day 8.
        form: filing({
          moment: "2026-10-27T07:00",
          replacement: "5144091",
          replacementGame: "not_started",
        }),
        now,
      });

      expect(result.status).toBe("recorded");
      const [request] = await db.select().from(subRequests);
      expect(request?.requestMoment.toISOString()).toBe("2026-10-27T14:00:00.000Z");
      expect(request?.expiresAt?.toISOString()).toBe("2026-10-28T15:00:00.000Z");
    }
  );
});

// H2, Q9, Q16: what the filing and the manual completion wrote is what the commissioner's detail
// reads back, through the real writers rather than hand-written event payloads.
describe("an on-behalf request's record on the commissioner's page", () => {
  webDbTest(
    "shows the filing's attestation and the amount computed at completion",
    async ({ database }) => {
      const { db } = database.connection;
      scripted(sharpeOnDay7);
      const user = await commissioner(db);
      await fileOnBehalfRequest({
        user,
        form: filing({
          moment: "2026-10-26T17:00",
          replacementGame: "in_progress",
          enteredPoints: "5.0",
          note: "Screenshot from the group chat.",
        }),
        now,
      });
      const [filed] = await db.select().from(subRequests);
      const requestId = filed?.requestId ?? "";
      const completion = new FormData();
      completion.set("version", String(filed?.version));
      completion.set("effectiveDay", "8");
      const completed = await actOnRequest({
        actorUserId: user.userId,
        requestId,
        action: "complete",
        form: completion,
        now,
      });

      const detail = await loadRequestDetail({ requestId });

      expect(completed.status).toBe("completed_manually");
      if (detail.status !== "found") throw new Error(`detail ${detail.status}`);
      expect(detail.filing).toMatchObject({
        replacementGame: "in_progress",
        enteredTenths: 50,
        note: "Screenshot from the group chat.",
      });
      expect(detail.adjustment.appliedTenths).not.toBe(filed?.projectedAdjustmentTenths);
      expect(detail.adjustment.computedTenths).toBe(detail.adjustment.appliedTenths);
    }
  );
});

describe("loadFilingChoices", () => {
  webDbTest(
    "offers the team's starters and bench players, with each starter's designation",
    async () => {
      scripted();

      const choices = await loadFilingChoices({ teamId: 1 });

      expect(choices.status).toBe("found");
      if (choices.status !== "found") return;
      expect(choices.starters.find((each) => each.playerId === LILLARD)).toEqual({
        playerId: LILLARD,
        name: "Damian Lillard",
        slot: "G",
        designation: "OUT",
      });
      expect(choices.bench.map((each) => each.playerId)).toContain(SHARPE);
      expect(choices.bench.some((each) => each.playerId === LILLARD)).toBe(false);
    }
  );
});
