import { describe, expect, it } from "vitest";
import { type RoutingInput, routeRequest, writeGateFor } from "./routing";

function routing(overrides: Partial<RoutingInput> = {}): RoutingInput {
  return {
    kind: "substitution",
    teamId: 5,
    optionKind: "direct",
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

  it("sends a rearrangement, a suspension, a playoff week or a bye to the commissioner before the gates", () => {
    expect(routeRequest(routing({ optionKind: "rearrangement" }))).toMatchObject({
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
      routeRequest(
        routing({ optionKind: "rearrangement", injuredDesignation: "SUSPENSION", allowlist: [] })
      )
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
});

describe("writeGateFor", () => {
  it("is open for an allowlisted team, and names why it's shut otherwise", () => {
    expect(writeGateFor([1, 2], 1)).toBe("open");
    expect(writeGateFor([], 1)).toBe("automation_off");
    expect(writeGateFor([2], 1)).toBe("not_allowlisted");
  });
});
