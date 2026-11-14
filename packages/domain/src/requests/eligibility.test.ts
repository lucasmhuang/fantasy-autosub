import { describe, expect, it } from "vitest";
import type { ClassifiableLineup, LineupPlayerRef } from "../lineup/classify-options";
import { lineup as testLineup, player as testPlayer } from "../lineup/test-lineups";
import {
  evaluateRequest,
  isRequestRefusalReason,
  type RequestEvaluationInput,
  type TeamRequestRef,
} from "./eligibility";
import type { SubRequestStatus } from "./lifecycle";

const guard = ["PG", "G", "UTIL", "BE", "IR"];
const forward = ["SF", "F", "UTIL", "BE", "IR"];
const center = ["C", "F/C", "UTIL", "BE", "IR"];

function player(playerId: number, eligibleSlots: string[]): LineupPlayerRef {
  return { playerId, eligibleSlots };
}

// Team 5: starters 1-10, bench 20 (a guard) and 21 (a forward), 30 on IR.
const teamFiveLineup: ClassifiableLineup = {
  starters: [
    { slot: "G", player: player(1, guard) },
    { slot: "G", player: player(2, guard) },
    { slot: "G", player: player(3, guard) },
    { slot: "F", player: player(4, forward) },
    { slot: "F", player: player(5, forward) },
    { slot: "F", player: player(6, forward) },
    { slot: "C", player: player(7, center) },
    { slot: "F/C", player: player(8, center) },
    { slot: "UTIL", player: player(9, forward) },
    { slot: "UTIL", player: player(10, center) },
  ],
  bench: [
    { slot: "BE", player: player(20, guard) },
    { slot: "BE", player: player(21, forward) },
  ],
  injuredReserve: [{ slot: "IR", player: player(30, guard) }],
};

// Tue 2026-10-27, day 8 of week 2 (days 7-13), 19:10 Pacific.
const confirmedAt = new Date("2026-10-28T02:10:00Z");

function request(overrides: Partial<RequestEvaluationInput> = {}): RequestEvaluationInput {
  return {
    kind: "substitution",
    requester: { role: "manager", teamId: 5 },
    teamId: 5,
    lineup: teamFiveLineup,
    injuredPlayerId: 2,
    injuredDesignation: "OUT",
    replacementPlayerId: 20,
    replacementDay: { tipAt: new Date("2026-10-28T03:00:00Z"), currentTenths: 0, final: false },
    week: { requestDay: 8, lastDay: 13, concluded: false, lastDayLatestTipAt: null },
    moment: confirmedAt,
    activeRequestId: null,
    teamRequests: [],
    provingDoneAt: null,
    attestation: null,
    ...overrides,
  };
}

describe("evaluateRequest: substitutions", () => {
  it("accepts an OUT starter and a bench player who fits his slot, with the live points at the request", () => {
    const result = evaluateRequest(
      request({ replacementDay: { tipAt: confirmedAt, currentTenths: 80, final: false } })
    );

    expect(result).toMatchObject({
      outcome: "valid",
      edit: {
        items: [
          { playerId: 2, fromSlot: "G", toSlot: "BE" },
          { playerId: 20, fromSlot: "BE", toSlot: "G" },
        ],
        movedStarters: 0,
      },
      pointsAtRequest: { tenths: 80, source: "observed" },
    });
  });

  it("refuses a starter no longer listed as OUT", () => {
    expect(evaluateRequest(request({ injuredDesignation: "DAY_TO_DAY" }))).toEqual({
      outcome: "refused",
      reason: "not_out",
    });
  });

  it("accepts a suspended starter, for the commissioner to decide", () => {
    expect(evaluateRequest(request({ injuredDesignation: "SUSPENSION" }))).toMatchObject({
      outcome: "valid",
    });
  });

  it("refuses a replacement who is no longer on the bench, IR included", () => {
    expect(evaluateRequest(request({ replacementPlayerId: 30 }))).toEqual({
      outcome: "refused",
      reason: "replacement_not_on_bench",
    });
  });

  it("refuses a starter who has left his starting slot", () => {
    expect(evaluateRequest(request({ injuredPlayerId: 21 }))).toEqual({
      outcome: "refused",
      reason: "injured_not_starting",
    });
  });

  it("refuses a bench player who can't start for the injured player in any arrangement", () => {
    const centersOnly: ClassifiableLineup = {
      ...teamFiveLineup,
      starters: teamFiveLineup.starters.map((slot) =>
        slot.slot === "UTIL"
          ? { slot: "UTIL", player: player(slot.player!.playerId, forward) }
          : slot
      ),
    };

    expect(evaluateRequest(request({ lineup: centersOnly, injuredPlayerId: 7 }))).toEqual({
      outcome: "refused",
      reason: "replacement_cannot_start",
    });
  });

  it("refuses a request for another manager's team", () => {
    expect(evaluateRequest(request({ teamId: 6 }))).toEqual({
      outcome: "refused",
      reason: "not_your_team",
    });
  });

  it("refuses a request once the matchup week has concluded", () => {
    expect(
      evaluateRequest(
        request({
          week: { requestDay: 13, lastDay: 13, concluded: true, lastDayLatestTipAt: null },
        })
      )
    ).toEqual({ outcome: "refused", reason: "week_over" });
  });

  it("refuses a request after the final day's last game, before ESPN's day changes", () => {
    const week = {
      requestDay: 13,
      lastDay: 13,
      concluded: false,
      lastDayLatestTipAt: new Date("2026-11-02T02:30:00Z"),
    };

    expect(evaluateRequest(request({ week, moment: new Date("2026-11-02T05:31:00Z") }))).toEqual({
      outcome: "refused",
      reason: "after_final_game",
    });
    expect(
      evaluateRequest(request({ week, moment: new Date("2026-11-02T05:29:00Z") }))
    ).toMatchObject({
      outcome: "valid",
    });
  });

  it("refuses a request on a final day with no games left at all", () => {
    expect(
      evaluateRequest(
        request({
          week: { requestDay: 13, lastDay: 13, concluded: false, lastDayLatestTipAt: null },
        })
      )
    ).toEqual({ outcome: "refused", reason: "after_final_game" });
  });

  // The season's final day is 2027-03-21 (day 153); 01:00Z on the 22nd is still the 21st Pacific.
  it("judges a request by ESPN's day, not the UTC date", () => {
    const week = {
      requestDay: 153,
      lastDay: 153,
      concluded: false,
      lastDayLatestTipAt: new Date("2027-03-22T00:30:00Z"),
    };

    expect(
      evaluateRequest(request({ week, moment: new Date("2027-03-22T01:00:00Z") }))
    ).toMatchObject({
      outcome: "valid",
    });
  });

  it("refuses a second request for an injured player who already has one this week, naming it", () => {
    expect(evaluateRequest(request({ activeRequestId: "req-1" }))).toEqual({
      outcome: "refused",
      reason: "active_request_exists",
      activeRequestId: "req-1",
    });
  });
});

describe("evaluateRequest: a replacement another request still in flight names (Dec-D30)", () => {
  // Team 5's request this matchup for its other OUT guard, naming bench player 20.
  function namedBy(status: SubRequestStatus): TeamRequestRef {
    return {
      requestId: "req-guard-3",
      status,
      injuredName: "Guard Three",
      replacementPlayerId: 20,
    };
  }

  it.each([
    "awaiting_approval",
    "queued",
    "executing",
    "needs_review",
  ] as const)("refuses him while that request is %s, naming its starter", (status) => {
    expect(evaluateRequest(request({ teamRequests: [namedBy(status)] }))).toEqual({
      outcome: "refused",
      reason: "replacement_in_flight",
      inFlightRequestId: "req-guard-3",
      starterName: "Guard Three",
    });
  });

  it.each([
    "completed",
    "completed_manually",
    "reversed",
    "refused",
    "rejected",
    "withdrawn",
  ] as const)("accepts him once that request is %s", (status) => {
    expect(evaluateRequest(request({ teamRequests: [namedBy(status)] }))).toMatchObject({
      outcome: "valid",
    });
  });
});

describe("evaluateRequest: on-behalf requests", () => {
  const commissioner = { role: "commissioner" as const, teamId: 1 };
  const tipAt = new Date("2026-10-28T03:00:00Z");

  function onBehalf(overrides: Partial<RequestEvaluationInput> = {}): RequestEvaluationInput {
    return request({
      kind: "on_behalf",
      requester: commissioner,
      replacementDay: { tipAt, currentTenths: 177, final: true },
      attestation: { replacementGame: "not_started", enteredTenths: null },
      ...overrides,
    });
  }

  it("accepts a stated moment before the replacement's tip time, crediting him from 0", () => {
    expect(evaluateRequest(onBehalf())).toMatchObject({
      outcome: "valid",
      pointsAtRequest: { tenths: 0, source: "observed" },
    });
  });

  it("refuses 'not started' when the schedule shows his game had tipped by the stated moment", () => {
    expect(evaluateRequest(onBehalf({ moment: new Date("2026-10-28T03:05:00Z") }))).toEqual({
      outcome: "refused",
      reason: "game_had_started",
    });
  });

  it("takes his whole line as scored before the request when his game had ended", () => {
    expect(
      evaluateRequest(onBehalf({ attestation: { replacementGame: "ended", enteredTenths: null } }))
    ).toMatchObject({ outcome: "valid", pointsAtRequest: { tenths: 177, source: "observed" } });
  });

  it("accepts hand-entered points from mid-game once the day's line is final, between 0 and that line", () => {
    const midGame = (enteredTenths: number) => ({
      replacementGame: "in_progress" as const,
      enteredTenths,
    });

    expect(evaluateRequest(onBehalf({ attestation: midGame(0) }))).toMatchObject({
      outcome: "valid",
      pointsAtRequest: { tenths: 0, source: "entered_by_hand" },
    });
    expect(evaluateRequest(onBehalf({ attestation: midGame(177) }))).toMatchObject({
      outcome: "valid",
      pointsAtRequest: { tenths: 177, source: "entered_by_hand" },
    });
    expect(evaluateRequest(onBehalf({ attestation: midGame(178) }))).toEqual({
      outcome: "refused",
      reason: "hand_entry_out_of_range",
    });
  });

  it("refuses mid-game points until the day's line is final, and a mid-game moment without them", () => {
    expect(
      evaluateRequest(
        onBehalf({
          replacementDay: { tipAt, currentTenths: 90, final: false },
          attestation: { replacementGame: "in_progress", enteredTenths: 40 },
        })
      )
    ).toEqual({ outcome: "refused", reason: "hand_entry_needs_final_line" });
    expect(
      evaluateRequest(
        onBehalf({ attestation: { replacementGame: "in_progress", enteredTenths: null } })
      )
    ).toEqual({ outcome: "refused", reason: "points_needed_mid_game" });
  });

  it("refuses an on-behalf request that comes without the commissioner's attestation", () => {
    expect(evaluateRequest(onBehalf({ attestation: null }))).toEqual({
      outcome: "refused",
      reason: "attestation_needed",
    });
  });

  it("refuses an on-behalf request for the filer's own team, and one filed by a manager", () => {
    expect(evaluateRequest(onBehalf({ teamId: 1 }))).toEqual({
      outcome: "refused",
      reason: "own_team_on_behalf",
    });
    expect(evaluateRequest(onBehalf({ requester: { role: "manager", teamId: 5 } }))).toEqual({
      outcome: "refused",
      reason: "commissioner_only",
    });
  });
});

describe("evaluateRequest: the proving request", () => {
  const commissioner = { role: "commissioner" as const, teamId: 1 };

  function proving(overrides: Partial<RequestEvaluationInput> = {}): RequestEvaluationInput {
    return request({
      kind: "proving",
      requester: commissioner,
      teamId: 1,
      injuredDesignation: "ACTIVE",
      ...overrides,
    });
  }

  it("accepts any starter on team 1 from the commissioner, skipping the OUT check", () => {
    expect(evaluateRequest(proving())).toMatchObject({ outcome: "valid" });
  });

  it("refuses a proving request for another team, from a manager, or once proving is done", () => {
    expect(
      evaluateRequest(proving({ teamId: 2, requester: { role: "commissioner", teamId: 2 } }))
    ).toEqual({
      outcome: "refused",
      reason: "proving_team_only",
    });
    expect(evaluateRequest(proving({ requester: { role: "manager", teamId: 1 } }))).toEqual({
      outcome: "refused",
      reason: "commissioner_only",
    });
    expect(evaluateRequest(proving({ provingDoneAt: new Date("2026-11-20T00:00:00Z") }))).toEqual({
      outcome: "refused",
      reason: "proving_done",
    });
  });

  it("accepts a one-move rearrangement and refuses one that moves two other starters", () => {
    // A power forward for the C, once the UTIL center moves to C: one move.
    const oneMove = proving({
      lineup: testLineup([testPlayer(20, "pf")]),
      injuredPlayerId: 7,
    });
    // A point guard for the C, once the UTIL forward moves to F/C and its forward-center to C.
    const twoMoves = proving({
      lineup: testLineup([testPlayer(20, "pg")], {
        8: testPlayer(8, "fc"),
        10: testPlayer(10, "sf"),
      }),
      injuredPlayerId: 7,
    });

    expect(evaluateRequest(oneMove)).toMatchObject({
      outcome: "valid",
      edit: { movedStarters: 1 },
    });
    expect(evaluateRequest(twoMoves)).toEqual({
      outcome: "refused",
      reason: "replacement_cannot_start",
    });
  });
});

describe("isRequestRefusalReason", () => {
  it("recognises a stored refusal reason, and nothing else", () => {
    expect(isRequestRefusalReason("not_out")).toBe(true);
    expect(isRequestRefusalReason("active_request_exists")).toBe(true);
    expect(isRequestRefusalReason("replacement_in_flight")).toBe(true);
    expect(isRequestRefusalReason("not_a_reason")).toBe(false);
  });
});
