import { describe, expect, it } from "vitest";
import type { ProvingRequestView } from "../../lib/server/proving";
import { renderMarkup, textOf } from "../test-support";
import { ProvingRun, ProvingView } from "./proving-view";

const zone = "America/Los_Angeles";
const at = new Date("2026-11-12T03:02:00.000Z");
const base: ProvingRequestView = {
  requestId: "0b5c1c9e-6a8e-4b8f-9c55-2f0f0b0f1a11",
  version: 3,
  status: "needs_review",
  reviewReason: "lineup_failed",
  filedAt: at,
  injuredName: "Stephen Curry",
  replacementName: "Walker Kessler",
  rehearsal: false,
  writes: [
    { step: "swap", status: "sent", outcome: "verified", sentAt: at, espnAnswer: null },
    { step: "token", status: "sent", outcome: "verified", sentAt: at, espnAnswer: null },
    { step: "revert", status: "sent", outcome: "verified", sentAt: at, espnAnswer: null },
  ],
  approve: null,
  cancel: false,
  putBack: true,
  stopped: {
    step: "restore",
    detail: "day_changed",
    restoreMoves: [
      { name: "Stephen Curry", fromSlot: "BN", toSlot: "G" },
      { name: "Walker Kessler", fromSlot: "G", toSlot: "BN" },
    ],
    sideToRestore: null,
    earlierDayKeepsSwap: false,
  },
};

// FS-PROVING-4, FM-PROVING-1: a stopped run's four steps, why it stopped and what to put back.
describe("a proving run", () => {
  it("shows its steps, the stop and the moves to make by hand, with its number", () => {
    const text = textOf(renderMarkup(<ProvingRun request={base} number={1} zone={zone} />));

    expect(text).toContain("Request 1 of 2");
    expect(text).toContain("1 · Swap");
    expect(text).toContain("4 · Restore the lineup");
    expect(text).toContain("Stopped: the day changed on ESPN before the restore.");
    expect(text).toContain("On ESPN, move Curry to G and Kessler to BN.");
    expect(text).toContain("I put team 1 back");
  });

  it("says why a run that never ran is with the commissioner", () => {
    const notRun = {
      ...base,
      reviewReason: "automation_off" as const,
      writes: [],
      stopped: { ...base.stopped, step: null } as ProvingRequestView["stopped"],
      putBack: false,
      cancel: true,
    };
    const text = textOf(renderMarkup(<ProvingRun request={notRun} number={null} zone={zone} />));

    expect(text).not.toContain("Request");
    expect(text).toContain("Not run: automation is off.");
    expect(text).toContain("Cancel");
  });
});

// FS-PROVING-5, IF-PROVING-2: only runs that went to ESPN and finished count toward the two.
describe("the proving page's runs", () => {
  const completed = (id: string, rehearsal = false): ProvingRequestView => ({
    ...base,
    requestId: id,
    status: "completed",
    reviewReason: null,
    rehearsal,
    putBack: false,
    stopped: null,
  });
  const view = (requests: ProvingRequestView[]) =>
    textOf(
      renderMarkup(
        <ProvingView
          page={{ status: "found", provingDoneAt: null, choices: null, requests }}
          automation={{ status: "off", changedAt: null }}
          status={undefined}
          zone={zone}
          now={at}
        />
      )
    );

  it("numbers the finished runs oldest first, and says both ran once two have", () => {
    const text = view([completed("c2"), { ...base, requestId: "s1" }, completed("c1")]);

    expect(text.indexOf("Request 2 of 2")).toBeLessThan(text.indexOf("Request 1 of 2"));
    expect(text.match(/Request \d/g)).toHaveLength(2);
    expect(text).toContain("Both proving requests ran end to end.");
  });

  it("never counts a rehearsed run, which sent nothing to ESPN", () => {
    const text = view([completed("r2", true), completed("c1")]);

    expect(text).not.toContain("Both proving requests ran end to end.");
    expect(text.match(/Request \d/g)).toEqual(["Request 1"]);
  });
});
