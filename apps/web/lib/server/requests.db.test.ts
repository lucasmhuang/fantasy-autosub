import { createEspnReadClient, type ScenarioName } from "@injurysub/espn";
import { describe, expect } from "vitest";
import { loadConfirmation } from "./requests";
import {
  insertInventedRequest,
  setRefusingWebEspn,
  setWebEspn,
  type TeamWeekChange,
  webDbTest,
} from "./test-support";

// Team 1 in the scenarios, on day 8 of matchup 2 (days 7-13): Damian Lillard (6606) is the OUT
// guard; Jeremiah Fears (5144091) a bench guard who can take his slot; Zach Edey (4600663) a bench
// center; Keegan Murray (4594327) is on IR.
const LILLARD = 6606;
const FEARS = 5144091;
const MURRAY = 4594327;
const EDEY = 4600663;

function scripted(scenario: ScenarioName, change?: TeamWeekChange): void {
  setWebEspn(createEspnReadClient({ mode: "scripted", scenario }), change);
}

const line = (fantasyPoints: number) => ({
  fantasyPoints,
  points: 0,
  rebounds: 0,
  assists: 0,
  steals: 0,
  blocks: 0,
  turnovers: 0,
});

function withLine(playerId: number, day: number, points: number, active: boolean): TeamWeekChange {
  return (read) => ({
    ...read,
    days: read.days.map((each) =>
      each.scoringPeriodId !== day
        ? each
        : {
            ...each,
            players: each.players.map((player) =>
              player.playerId === playerId ? { ...player, active, line: line(points) } : player
            ),
          }
    ),
  });
}

const lillardOut: TeamWeekChange = (read) => ({
  ...read,
  lineup: {
    ...read.lineup,
    starters: read.lineup.starters.map((slot) =>
      slot.player?.playerId === LILLARD
        ? { ...slot, player: { ...slot.player, designation: { status: "OUT" } } }
        : slot
    ),
  },
});

const ask = { teamId: 1, injuredId: LILLARD, replacementId: FEARS };

describe("loadConfirmation", () => {
  webDbTest(
    "summarizes the swap with its projected adjustment, day by day, and a fresh key",
    async () => {
      scripted("one-out-starter", (read) =>
        withLine(FEARS, 8, 12.4, false)(withLine(LILLARD, 7, 20.5, true)(read))
      );

      const view = await loadConfirmation(ask);

      expect(view).toMatchObject({
        status: "confirm",
        starter: { playerId: LILLARD, name: "Damian Lillard", slot: "G" },
        option: { playerId: FEARS, name: "Jeremiah Fears", status: "ready_now" },
        rulesHeld: false,
        projection: {
          totalTenths: -329,
          lines: [
            { day: 7, name: "Damian Lillard", tenths: -205, why: "injured_credited_before_swap" },
            { day: 8, name: "Jeremiah Fears", tenths: -124, why: "replacement_before_request" },
          ],
        },
      });
      expect(view.status === "confirm" && view.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    }
  );

  webDbTest("projects no adjustment before anyone has scored", async () => {
    scripted("one-out-starter");

    expect(await loadConfirmation(ask)).toMatchObject({
      status: "confirm",
      projection: { totalTenths: 0, lines: [] },
    });
  });

  webDbTest("says the adjustment would be held while the league's rules differ", async () => {
    scripted("rules-mismatch", lillardOut);

    expect(await loadConfirmation(ask)).toMatchObject({ status: "confirm", rulesHeld: true });
  });

  webDbTest("offers nothing for an IR player or a Not valid bench player", async () => {
    scripted("one-out-starter", (read) => ({
      ...read,
      lineup: {
        ...read.lineup,
        bench: read.lineup.bench.map((slot) =>
          slot.player?.playerId === EDEY
            ? { ...slot, player: { ...slot.player, eligibleSlots: ["BE", "IR"] } }
            : slot
        ),
      },
    }));

    for (const replacementId of [MURRAY, EDEY]) {
      expect(await loadConfirmation({ ...ask, replacementId })).toEqual({ status: "not_offered" });
    }
  });

  webDbTest("points to the starter's request when he already has one", async ({ database }) => {
    scripted("one-out-starter");
    const requestId = await insertInventedRequest(database.connection.db);

    expect(await loadConfirmation(ask)).toEqual({ status: "already_requested", requestId });
  });

  webDbTest("says ESPN can't be reached when the worker doesn't answer", async () => {
    setRefusingWebEspn("worker_unreachable");

    expect(await loadConfirmation(ask)).toEqual({ status: "unavailable" });
  });
});
