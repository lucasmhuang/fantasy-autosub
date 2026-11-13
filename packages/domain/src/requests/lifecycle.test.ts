import { describe, expect, it } from "vitest";
import {
  type ActionContext,
  allowedActions,
  blocksNewRequest,
  executorTransition,
  type RequestAction,
  type RequestState,
  type ReviewReason,
  resumeStepFor,
  type SubRequestStatus,
  subRequestStatuses,
  transition,
} from "./lifecycle";

const open: ActionContext = { matchupEnded: false, writeGate: "open" };

function state(
  status: SubRequestStatus,
  fields: Partial<Omit<RequestState, "status">> = {}
): RequestState {
  return {
    status,
    reviewReason: null,
    lineupState: "pending",
    adjustmentState: "pending",
    ...fields,
  };
}

function inReview(reviewReason: ReviewReason, fields: Partial<RequestState> = {}): RequestState {
  return state("needs_review", { reviewReason, ...fields });
}

function outcome(from: RequestState, action: RequestAction, context: ActionContext = open) {
  return transition(from, action, context);
}

describe("transition: withdraw", () => {
  it("withdraws a waiting request, or one in review with nothing written to ESPN", () => {
    for (const from of [state("queued"), state("awaiting_approval"), inReview("automation_off")]) {
      expect(outcome(from, { type: "withdraw" })).toEqual({
        ok: true,
        status: "withdrawn",
        reviewReason: null,
      });
    }
  });

  it("refuses to withdraw a request being executed, or one whose lineup write was sent", () => {
    expect(outcome(state("executing"), { type: "withdraw" })).toEqual({
      ok: false,
      refusal: "not_allowed_in_status",
    });
    expect(
      outcome(inReview("adjustment_held_rules", { lineupState: "verified" }), { type: "withdraw" })
    ).toEqual({ ok: false, refusal: "already_on_espn" });
    expect(
      outcome(inReview("lineup_failed", { lineupState: "failed" }), { type: "withdraw" })
    ).toEqual({
      ok: false,
      refusal: "already_on_espn",
    });
  });
});

describe("transition: reject", () => {
  it("rejects a request waiting for approval or in review while ESPN is untouched", () => {
    expect(outcome(state("awaiting_approval"), { type: "reject" })).toMatchObject({
      ok: true,
      status: "rejected",
    });
    expect(
      outcome(inReview("lineup_failed", { lineupState: "failed" }), { type: "reject" })
    ).toMatchObject({
      ok: true,
      status: "rejected",
    });
  });

  it("refuses to reject once completed, or once ESPN's lineup may have changed", () => {
    expect(outcome(state("completed", { lineupState: "verified" }), { type: "reject" })).toEqual({
      ok: false,
      refusal: "not_allowed_in_status",
    });
    expect(
      outcome(inReview("ambiguous", { lineupState: "ambiguous" }), { type: "reject" })
    ).toEqual({
      ok: false,
      refusal: "already_on_espn",
    });
  });
});

describe("transition: reverse", () => {
  it("reverses only a completed substitution", () => {
    for (const status of subRequestStatuses) {
      const result = outcome(state(status, { lineupState: "verified" }), { type: "reverse" });
      const expected = status === "completed" || status === "completed_manually";
      expect({ status, ok: result.ok }).toEqual({ status, ok: expected });
    }
  });
});

describe("transition: approve", () => {
  it("queues a request waiting for approval", () => {
    expect(outcome(state("awaiting_approval"), { type: "approve" })).toEqual({
      ok: true,
      status: "queued",
      reviewReason: null,
    });
  });

  it("queues a request in review only for a suspension, a stale plan or expiry", () => {
    const approvable: ReviewReason[] = ["suspension", "stale", "expired"];
    const settledByHand: ReviewReason[] = [
      "automation_off",
      "not_allowlisted",
      "rearrangement",
      "ambiguous",
      "lineup_failed",
      "adjustment_failed",
      "adjustment_held_rules",
      "adjustment_changed",
      "week_ended",
      "playoffs",
    ];

    for (const reason of approvable) {
      expect(outcome(inReview(reason), { type: "approve" })).toMatchObject({
        ok: true,
        status: "queued",
      });
    }
    for (const reason of settledByHand) {
      expect(outcome(inReview(reason), { type: "approve" })).toEqual({
        ok: false,
        refusal: "not_allowed_in_status",
      });
    }
  });

  it("refuses to approve once the matchup has ended", () => {
    expect(
      outcome(state("awaiting_approval"), { type: "approve" }, { ...open, matchupEnded: true })
    ).toEqual({
      ok: false,
      refusal: "week_ended",
    });
  });

  it("refuses to approve while automation is off or the team isn't allowlisted", () => {
    expect(
      outcome(inReview("suspension"), { type: "approve" }, { ...open, writeGate: "automation_off" })
    ).toEqual({ ok: false, refusal: "automation_off" });
    expect(
      outcome(
        state("awaiting_approval"),
        { type: "approve" },
        { ...open, writeGate: "not_allowlisted" }
      )
    ).toEqual({ ok: false, refusal: "not_allowlisted" });
  });
});

describe("transition: reapprove", () => {
  const held = { lineupState: "verified", adjustmentState: "held" } as const;

  it("queues a held adjustment again, even after the matchup has ended", () => {
    for (const reason of ["adjustment_held_rules", "adjustment_changed"] as const) {
      expect(outcome(inReview(reason, held), { type: "reapprove" })).toMatchObject({
        ok: true,
        status: "queued",
      });
      expect(
        outcome(inReview(reason, held), { type: "reapprove" }, { ...open, matchupEnded: true })
      ).toMatchObject({ ok: true, status: "queued" });
    }
  });

  it("reapproves nothing else, and nothing while the write gate is closed", () => {
    expect(outcome(inReview("stale"), { type: "reapprove" })).toEqual({
      ok: false,
      refusal: "not_allowed_in_status",
    });
    expect(
      outcome(
        inReview("adjustment_changed", held),
        { type: "reapprove" },
        { ...open, writeGate: "automation_off" }
      )
    ).toEqual({ ok: false, refusal: "automation_off" });
  });
});

describe("transition: settling by hand", () => {
  it("records a manual completion of a request waiting for approval or in review, after the week too", () => {
    for (const from of [
      state("awaiting_approval"),
      inReview("automation_off"),
      inReview("week_ended"),
    ]) {
      expect(outcome(from, { type: "complete_manually" }, { ...open, matchupEnded: true })).toEqual(
        { ok: true, status: "completed_manually", reviewReason: null }
      );
    }
  });

  it("keeps an override on a request waiting for the commissioner, without changing its status", () => {
    expect(outcome(inReview("adjustment_changed"), { type: "override" })).toEqual({
      ok: true,
      status: "needs_review",
      reviewReason: "adjustment_changed",
    });
    expect(outcome(state("completed"), { type: "override" })).toEqual({
      ok: false,
      refusal: "not_allowed_in_status",
    });
  });
});

describe("transition: sweeps", () => {
  it("sends a waiting request to review when it expires or its matchup ends", () => {
    for (const from of [state("awaiting_approval"), state("queued")]) {
      expect(outcome(from, { type: "expire" })).toEqual({
        ok: true,
        status: "needs_review",
        reviewReason: "expired",
      });
      expect(outcome(from, { type: "end_week" })).toEqual({
        ok: true,
        status: "needs_review",
        reviewReason: "week_ended",
      });
    }
    expect(outcome(state("executing"), { type: "expire" })).toMatchObject({ ok: false });
  });
});

describe("allowedActions", () => {
  it("lists what can be done to a request in its state", () => {
    expect(allowedActions(state("awaiting_approval"), open)).toEqual([
      "withdraw",
      "reject",
      "approve",
      "override",
      "complete_manually",
    ]);
    expect(allowedActions(state("completed", { lineupState: "verified" }), open)).toEqual([
      "reverse",
    ]);
  });
});

describe("blocksNewRequest", () => {
  it("frees the injured player for a new request only after a refusal, rejection or withdrawal", () => {
    const freeing = subRequestStatuses.filter((status) => !blocksNewRequest(status));

    expect(freeing).toEqual(["refused", "rejected", "withdrawn"]);
  });
});

describe("resumeStepFor", () => {
  it("resumes at the adjustment once the lineup is verified, and at the preflight otherwise", () => {
    expect(resumeStepFor(inReview("adjustment_held_rules", { lineupState: "verified" }))).toBe(
      "adjustment"
    );
    expect(resumeStepFor(inReview("stale"))).toBe("preflight");
  });
});

describe("executorTransition", () => {
  it("claims only a queued request, for execution", () => {
    expect(executorTransition(state("queued"), { type: "claim" })).toEqual({
      ok: true,
      status: "executing",
      reviewReason: null,
    });
    for (const status of subRequestStatuses.filter((candidate) => candidate !== "queued")) {
      expect(executorTransition(state(status), { type: "claim" })).toEqual({
        ok: false,
        refusal: "not_allowed_in_status",
      });
    }
  });

  it("sends a queued or executing request to review with the executor's reason", () => {
    for (const status of ["queued", "executing"] as const) {
      expect(executorTransition(state(status), { type: "review", reason: "stale" })).toEqual({
        ok: true,
        status: "needs_review",
        reviewReason: "stale",
      });
    }
    const others = subRequestStatuses.filter((s) => s !== "queued" && s !== "executing");
    for (const status of others) {
      expect(executorTransition(state(status), { type: "review", reason: "expired" }).ok).toBe(
        false
      );
    }
  });

  it("completes only a request it is executing", () => {
    expect(executorTransition(state("executing"), { type: "complete" })).toEqual({
      ok: true,
      status: "completed",
      reviewReason: null,
    });
    for (const status of subRequestStatuses.filter((candidate) => candidate !== "executing")) {
      expect(executorTransition(state(status), { type: "complete" }).ok).toBe(false);
    }
  });
});
