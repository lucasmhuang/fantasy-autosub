import { describe, expect, it } from "vitest";
import {
  NO_BOARD_TEXT,
  notRunText,
  provingDoneText,
  restoreMovesText,
  restoreSideText,
  runSteps,
  startTitle,
  stopText,
} from "./proving-text";

describe("restoreSideText", () => {
  it("names the note to put back on your team's side", () => {
    expect(restoreSideText({ tenths: -404, reason: "Injury sub: Larsson for Tatum, -40.4" })).toBe(
      "Check your team’s adjustment on ESPN. If it isn’t -40.4 points with the note “Injury sub: Larsson for Tatum, -40.4”, set it back to that."
    );
  });

  // Owner, 2026-11-14: a side that had no note says so, not an empty quote.
  it("says no note when the side had none", () => {
    expect(restoreSideText({ tenths: 0, reason: "" })).toBe(
      "Check your team’s adjustment on ESPN. If it isn’t 0.0 points with no note, set it back to that."
    );
  });
});

// Copy table 1, S5: a refused cookie is a refusal, never "can't reach".
describe("NO_BOARD_TEXT", () => {
  it("says the cookie was refused, or that there's none yet", () => {
    expect(NO_BOARD_TEXT.credentials_rejected).toBe("ESPN refused the cookie.");
    expect(NO_BOARD_TEXT.not_connected).toBe("No ESPN cookie yet.");
  });
});

describe("notRunText", () => {
  it("says why a proving request that never ran is with the commissioner", () => {
    expect(notRunText("lineup_failed")).toBe("Not run: ESPN didn’t take the swap.");
    expect(notRunText("automation_off")).toBe("Not run: automation is off.");
    // Copy table 1, W3: the commissioner's own team is "your team", ticked or not.
    expect(notRunText("not_allowlisted")).toBe("Not run: your team isn’t ticked.");
    expect(notRunText("playoffs")).toContain("your team has no opponent");
  });

  it("falls back to the queue's pill for any other reason", () => {
    expect(notRunText("adjustment_held_rules")).toBe("Not run: adjustment held.");
    expect(notRunText("ambiguous")).toBe("Not run: check ESPN.");
  });
});

describe("stopText", () => {
  it("names the step a run stopped at and what was found there", () => {
    expect(stopText("token", "not_applied")).toBe(
      "Stopped at the test adjustment: ESPN didn’t show it. Nothing more was sent."
    );
  });

  it("names your team and InjurySub, never team 1 or the worker", () => {
    expect(stopText("token", "already_noted")).toContain("your team’s side");
    expect(stopText("token", "not_allowlisted")).toContain("your team was unticked");
    expect(stopText("token", "pass_failed")).toContain("InjurySub kept failing");
  });

  it("names the step alone for a detail it has no words for", () => {
    expect(stopText("restore", "something_new")).toBe(
      "Stopped at putting the lineup back. Nothing more was sent."
    );
  });

  it("says nothing of a stop the run didn't make itself", () => {
    expect(stopText(null, "not_applied")).toBeNull();
  });
});

const zone = "America/Los_Angeles";
const at = new Date("2026-11-12T03:02:00.000Z");
const write = (
  step: "swap" | "token" | "revert" | "restore",
  over: Record<string, unknown> = {}
) => ({
  step,
  status: "sent",
  outcome: "verified",
  sentAt: at,
  espnAnswer: null,
  ...over,
});
const run = { injuredName: "Stephen Curry", replacementName: "Walker Kessler" };

// FS-PROVING-4: each run's four steps, in order, each with its state.
describe("runSteps", () => {
  it("reads each step from its write: on ESPN, being checked, not yet", () => {
    const steps = runSteps(
      { ...run, writes: [write("swap"), write("token", { outcome: null })], stopped: false },
      zone
    );

    expect(steps.map(({ kind, when }) => [kind, when])).toEqual([
      ["ok", "On ESPN Wed 7:02 PM PT"],
      ["waiting", "Sent; checking ESPN…"],
      ["pending", "Not yet"],
      ["pending", "Not yet"],
    ]);
    expect(steps.map((step) => step.title)).toEqual([
      "1 · Swap",
      "2 · Test adjustment",
      "3 · Revert the adjustment",
      "4 · Restore the lineup",
    ]);
    expect(steps[1]?.detail).toBe(
      "+0.1 on your matchup, reason \u201cInjurySub test (reverted)\u201d"
    );
    expect(steps[0]?.detail).toBe("Kessler in for Curry, on your lineup today");
  });

  it("marks the step a stopped run didn't get through as stopped", () => {
    const steps = runSteps(
      {
        ...run,
        writes: [
          write("swap"),
          write("token"),
          write("revert"),
          write("restore", { outcome: "not_applied" }),
        ],
        stopped: true,
      },
      zone
    );

    expect(steps.map(({ kind, when }) => [kind, when]).at(-1)).toEqual(["fail", "Stopped"]);
  });

  it("marks a rehearsed step as recorded, never as on ESPN", () => {
    const steps = runSteps(
      {
        ...run,
        writes: [write("swap", { status: "recorded_only", outcome: null })],
        stopped: false,
      },
      zone
    );

    expect(steps[0]).toMatchObject({ kind: "pending", when: "Recorded, not sent" });
  });
});

describe("the proving page's sentences", () => {
  it("names the run the start form files (FS-PROVING-3, -5)", () => {
    expect(startTitle(0)).toBe("Request 1 of 2: a direct swap");
    expect(startTitle(1)).toBe("Request 2 of 2: a one-move rearrangement");
    expect(startTitle(2)).toBe("Another proving request");
  });

  // FM-PROVING-1, as the canvas draws it.
  it("says the day changed before the restore", () => {
    expect(stopText("restore", "day_changed")).toBe(
      "Stopped: the day changed on ESPN before the restore. Nothing more was sent."
    );
  });

  it("says what to put back on ESPN by hand (FM-PROVING-1)", () => {
    expect(
      restoreMovesText([
        { name: "Stephen Curry", fromSlot: "BE", toSlot: "G" },
        { name: "Walker Kessler", fromSlot: "G", toSlot: "BE" },
      ])
    ).toBe("On ESPN, move Curry to G and Kessler to BN.");
  });

  it("says further runs are refused once proving is done (FM-PROVING-2)", () => {
    expect(provingDoneText(new Date("2026-11-19T18:12:00.000Z"), zone)).toBe(
      "Proving is done (Thu Nov 19, 10:12 AM PT), so further proving runs are refused."
    );
  });
});
