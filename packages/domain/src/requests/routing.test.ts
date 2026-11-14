import { describe, expect, it } from "vitest";
import { lineup, player } from "../lineup/test-lineups";
import { type LineupEdit, planLineupEdit } from "./lineup-edit";
import { type RoutingInput, routeRequest, writeGateFor } from "./routing";

function editFor(input: Parameters<typeof planLineupEdit>[0]): LineupEdit {
  const edit = planLineupEdit(input);
  if (edit === null) throw new Error("no edit fits the test lineup");
  return edit;
}

// The test lineups' edits: a small forward for the injured F (a direct swap); a power forward for
// the injured C, once the UTIL center moves to C (one move); a center for the injured F, into the
// empty UTIL (no one moves); a point guard for the injured C, once the UTIL forward moves to F/C
// and its forward-center to C (two moves).
const directSwap = editFor({
  lineup: lineup([player(20, "sf")]),
  injuredPlayerId: 4,
  replacementPlayerId: 20,
});
const oneMove = editFor({
  lineup: lineup([player(20, "pf")]),
  injuredPlayerId: 7,
  replacementPlayerId: 20,
});
const openSlot = editFor({
  lineup: lineup([player(20, "c")], { 10: null }),
  injuredPlayerId: 4,
  replacementPlayerId: 20,
});
const twoMoves = editFor({
  lineup: lineup([player(20, "pg")], { 8: player(8, "fc"), 10: player(10, "sf") }),
  injuredPlayerId: 7,
  replacementPlayerId: 20,
});

function routing(overrides: Partial<RoutingInput> = {}): RoutingInput {
  return {
    kind: "substitution",
    teamId: 5,
    edit: directSwap,
    injuredDesignation: "OUT",
    period: { isPlayoffs: false, hasOpponent: true },
    allowlist: [1, 5],
    mode: "auto",
    ...overrides,
  };
}

describe("routeRequest", () => {
  it("queues an allowlisted direct swap in auto mode", () => {
    expect(routeRequest(routing())).toEqual({ status: "queued", reviewReason: null });
  });

  it("waits for approval in approval-required mode, an on-behalf request included", () => {
    expect(routeRequest(routing({ mode: "approval_required" }))).toEqual({
      status: "awaiting_approval",
      reviewReason: null,
    });
    expect(routeRequest(routing({ kind: "on_behalf", mode: "approval_required" }))).toEqual({
      status: "awaiting_approval",
      reviewReason: null,
    });
  });

  it("sends every request to the commissioner while automation is off", () => {
    expect(routeRequest(routing({ allowlist: [] }))).toEqual({
      status: "needs_review",
      reviewReason: "automation_off",
    });
  });

  it("sends a team outside the allowlist to the commissioner", () => {
    expect(routeRequest(routing({ allowlist: [1] }))).toEqual({
      status: "needs_review",
      reviewReason: "not_allowlisted",
    });
  });

  it("puts a one-move rearrangement through the gates, like a direct swap", () => {
    expect(oneMove.movedStarters).toBe(1);
    expect(routeRequest(routing({ edit: oneMove }))).toEqual({
      status: "queued",
      reviewReason: null,
    });
    expect(routeRequest(routing({ edit: oneMove, mode: "approval_required" }))).toEqual({
      status: "awaiting_approval",
      reviewReason: null,
    });
  });

  it("sends an edit that moves two or more other starters to the commissioner as a rearrangement", () => {
    expect(twoMoves.movedStarters).toBe(2);
    expect(routeRequest(routing({ edit: twoMoves }))).toEqual({
      status: "needs_review",
      reviewReason: "rearrangement",
    });
  });

  it("puts a replacement who takes an open starting slot through the gates, as two items", () => {
    expect(openSlot.items).toHaveLength(2);
    expect(routeRequest(routing({ edit: openSlot }))).toEqual({
      status: "queued",
      reviewReason: null,
    });
  });

  it("sends a one-move rearrangement for a suspended starter to the commissioner as a suspension", () => {
    expect(routeRequest(routing({ edit: oneMove, injuredDesignation: "SUSPENSION" }))).toEqual({
      status: "needs_review",
      reviewReason: "suspension",
    });
  });

  it("sends a rearrangement, a suspension, a playoff week or a bye to the commissioner before the gates", () => {
    expect(routeRequest(routing({ edit: twoMoves }))).toMatchObject({
      reviewReason: "rearrangement",
    });
    expect(routeRequest(routing({ injuredDesignation: "SUSPENSION" }))).toMatchObject({
      reviewReason: "suspension",
    });
    expect(
      routeRequest(routing({ period: { isPlayoffs: true, hasOpponent: true } }))
    ).toMatchObject({
      reviewReason: "playoffs",
    });
    expect(
      routeRequest(routing({ period: { isPlayoffs: false, hasOpponent: false } }))
    ).toMatchObject({
      reviewReason: "playoffs",
    });
    expect(
      routeRequest(routing({ edit: twoMoves, injuredDesignation: "SUSPENSION", allowlist: [] }))
    ).toEqual({ status: "needs_review", reviewReason: "rearrangement" });
  });

  it("routes the proving request by the gates alone, whatever its starter's designation", () => {
    expect(
      routeRequest(
        routing({
          kind: "proving",
          teamId: 1,
          injuredDesignation: "SUSPENSION",
          mode: "approval_required",
        })
      )
    ).toEqual({ status: "awaiting_approval", reviewReason: null });
  });

  it("routes a two-move proving request by the gates too: only the option's hold is skipped", () => {
    expect(routeRequest(routing({ kind: "proving", teamId: 1, edit: twoMoves }))).toMatchObject({
      reviewReason: null,
    });
  });

  it("holds a proving request in a week without an opponent, whose side can't take the test adjustment", () => {
    expect(
      routeRequest(
        routing({ kind: "proving", teamId: 1, period: { isPlayoffs: false, hasOpponent: false } })
      )
    ).toEqual({ status: "needs_review", reviewReason: "playoffs" });
    expect(
      routeRequest(
        routing({ kind: "proving", teamId: 1, period: { isPlayoffs: true, hasOpponent: true } })
      )
    ).toEqual({ status: "needs_review", reviewReason: "playoffs" });
  });
});

describe("writeGateFor", () => {
  it("is open for an allowlisted team, and names why it's shut otherwise", () => {
    expect(writeGateFor([1, 2], 1)).toBe("open");
    expect(writeGateFor([], 1)).toBe("automation_off");
    expect(writeGateFor([2], 1)).toBe("not_allowlisted");
  });
});
