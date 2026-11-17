import type { SubRequestRecord } from "@injurysub/db";
import { describe, expect, it } from "vitest";
import type { ManualSteps } from "../../lib/server/commish";
import { byHandWords, reverseWords } from "./by-hand-copy";

const zone = "America/Los_Angeles";
const now = new Date("2026-11-17T05:00:00.000Z");
// Mon 8:10 PM PT.
const t = new Date("2026-11-17T04:10:00.000Z");
const reading = { zone, now };

const request = {
  teamId: 4,
  injuredPlayerId: 6606,
  injuredName: "Jaylen Brown",
  replacementPlayerId: 7,
  replacementName: "Aaron Nesmith",
  requestMoment: new Date("2026-11-12T02:10:00.000Z"),
  requestDay: 23,
  matchupPeriodId: 4,
} as SubRequestRecord;

type Ready = Extract<ManualSteps, { status: "ready" }>;
const ready = (overrides: Partial<Ready> = {}): Ready => ({
  status: "ready",
  readAt: t,
  lineupMoves: [
    { playerId: 7, name: "Aaron Nesmith", fromSlot: "BE", toSlot: "F" },
    { playerId: 6606, name: "Jaylen Brown", fromSlot: "F", toSlot: "BE" },
  ],
  lineupNoLongerFits: null,
  lineupDoneAt: null,
  confirmedMoves: null,
  heldForEarlier: null,
  adjustment: {
    matchupPeriodId: 4,
    teamName: "Half-Court Heroes",
    currentTenths: -120,
    deltaTenths: -194,
    enterTenths: -314,
    reason: "Injury sub: Nesmith for Brown, −19.4",
    reasonTooLong: false,
  },
  ...overrides,
});

const words = (steps: ManualSteps) =>
  byHandWords({ steps, request, team: "Half-Court Heroes" }, reading);

describe("byHandWords", () => {
  it("numbers the lineup, the adjustment, the note and marking it done, from ESPN as read", () => {
    const result = words(ready());

    expect(result).toMatchObject({ kind: "steps", readAt: "From ESPN Mon 8:10 PM PT", notes: [] });
    expect(result.kind === "steps" && result.steps).toEqual([
      {
        title: "Lineup, Half-Court Heroes, Wed Nov 11",
        text: "In League Manager tools, edit the lineup for that day.",
        moves: [
          { playerId: 7, text: "Nesmith BN → F", out: false },
          { playerId: 6606, text: "Brown F → BN", out: true },
        ],
      },
      {
        title: "Adjustment on ESPN's Scoreboard",
        text: "Open Matchup 4, then Adjust Scoring on Half-Court Heroes' pairing. Enter −31.4: −12.0 already there, plus this request's −19.4.",
        value: { text: "−31.4", what: "the adjustment" },
      },
      {
        title: "Note (the whole league sees it on ESPN)",
        text: "Newest entry last. 36 of 1,000 characters.",
        value: { text: "Injury sub: Nesmith for Brown, −19.4", long: true, what: "the note" },
      },
      {
        title: "Then mark it done here",
        text: "Give the first day ESPN showed Nesmith active.",
      },
    ]);
  });

  it("checks off a lineup already done on ESPN", () => {
    const result = words(ready({ lineupMoves: [], lineupDoneAt: t }));

    expect(result.kind === "steps" && result.steps[0]).toEqual({
      title: "Lineup, Half-Court Heroes, Wed Nov 11",
      text: "Done: on ESPN Mon 8:10 PM PT.",
      done: true,
    });
  });

  it("says the lineup no longer fits, keeping the adjustment", () => {
    const result = words(ready({ lineupMoves: [], lineupNoLongerFits: { starterSlot: "BE" } }));

    expect(result.kind === "steps" && result.notes).toEqual([
      {
        tone: "stop",
        text: "Brown is no longer starting on ESPN (he's at BN), so there are no moves to list. Settle it as adjustment only, or reject it.",
      },
    ]);
    expect(result.kind === "steps" && result.steps.map(({ title }) => title)).toEqual([
      "Adjustment on ESPN's Scoreboard",
      "Note (the whole league sees it on ESPN)",
      "Then mark it done here",
    ]);
  });

  it("says when there's no adjustment, a note too long, or one held for an earlier credit", () => {
    const none = words(ready({ adjustment: null }));
    const tooLong = words(
      ready({ adjustment: { ...ready().adjustment!, reason: null, reasonTooLong: true } })
    );
    const held = words(ready({ adjustment: null, heldForEarlier: { earlierRequestId: "e1" } }));

    expect(none.kind === "steps" && none.notes).toEqual([
      { tone: "stop", text: "No adjustment: Brown hadn't played this week before the request." },
    ]);
    expect(tooLong.kind === "steps" && tooLong.notes).toEqual([
      {
        tone: "warn",
        text: "This request's entry would take the note past the 1,000 characters InjurySub sends. Shorten the older entries in ESPN's note first; this request's entry stays whole.",
      },
    ]);
    expect(tooLong.kind === "steps" && tooLong.steps[2]?.value).toBeUndefined();
    expect(held.kind === "steps" && held.notes[0]?.text).toBe(
      "Nesmith's points from the earlier request that put him in count against this adjustment, which InjurySub can't work out. Set the amount as an override, then enter it on ESPN."
    );
  });

  it("says ESPN couldn't be read, or has moved past the matchup", () => {
    expect(words({ status: "unavailable", reason: "espn_unreachable", readAt: t })).toEqual({
      kind: "unreadable",
      readAt: "Read failed Mon 8:10 PM PT",
    });
    const moved = words({
      status: "unavailable",
      reason: "week_moved_on",
      readAt: t,
      deltaTenths: -194,
    });
    expect(moved.kind === "steps" && moved.notes[0]?.text).toBe(
      "ESPN has moved past this matchup, so a lineup change can't reach it: post the adjustment only. To change the amount, set an override first."
    );
    expect(moved.kind === "steps" && moved.steps[0]).toEqual({
      title: "Adjustment on ESPN's Scoreboard",
      text: "Open Matchup 4, then Adjust Scoring on Half-Court Heroes' pairing, and add this request's −19.4 to the adjustment already there.",
    });
  });

  it("has nothing to do by hand for a request that doesn't wait on the commissioner", () => {
    expect(words({ status: "not_needed" })).toEqual({ kind: "none" });
  });
});

describe("reverseWords", () => {
  it("says the value to set and what's there now, with no double negative", () => {
    expect(
      reverseWords({
        request,
        team: "Glass Cannons",
        reversal: { currentTenths: -878, enterTenths: 0, appliedTenths: -878 },
      })
    ).toEqual({
      text: "On ESPN's Scoreboard, open Matchup 4, then Adjust Scoring on Glass Cannons' pairing. Set their adjustment to 0.0 (now −87.8), then mark it reversed. The lineup stays unless you change it on ESPN. Brown can't be requested again this week.",
      value: "0.0",
    });
  });
});
