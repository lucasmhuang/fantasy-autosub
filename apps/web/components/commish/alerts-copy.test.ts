import { describe, expect, it } from "vitest";
import { alertTimeLine, alertTitle, moveLine, watchLine } from "./alerts-copy";

const reading = { zone: "America/Los_Angeles", now: new Date("2026-11-12T03:00:00.000Z") };
const espnAt = new Date("2026-11-11T23:12:00.000Z");
const foundAt = new Date("2026-11-11T23:13:00.000Z");

describe("an alert's title, by kind (Revision 5, B)", () => {
  it.for([
    ["lm_transaction", "Lineup change on Backdoor Cutters"],
    ["lm_adjustment", "Adjustment on Backdoor Cutters"],
    ["lm_league_change", "League settings changed"],
    ["adjustment_mismatch", "Adjustment differs on Backdoor Cutters"],
    ["league_public", "The league is public"],
  ] as const)("titles %s as %s", ([kind, title]) => {
    expect(alertTitle(kind, "Backdoor Cutters")).toBe(title);
  });

  it("says the league where an alert names no team", () => {
    expect(alertTitle("lm_transaction", null)).toBe("Lineup change on a team");
  });
});

describe("an alert's times (Revision 5, I)", () => {
  it("gives ESPN's time and when InjurySub saw it", () => {
    expect(alertTimeLine(espnAt, foundAt, reading)).toBe(
      "ESPN's time 3:12 PM PT · seen 3:13 PM PT"
    );
    const nextDay = new Date("2026-11-12T08:30:00.000Z");
    expect(alertTimeLine(espnAt, nextDay, reading)).toBe(
      "ESPN's time 3:12 PM PT · seen Thu 12:30 AM PT"
    );
  });

  it("gives when it was seen where ESPN gave no time", () => {
    expect(alertTimeLine(null, foundAt, reading)).toBe("Seen 3:13 PM PT");
  });
});

// FS-ALERTS-1, FM-ALERTS-1, Revision 5 E.
describe("the watch's line", () => {
  it("says it's watching, and when it last checked", () => {
    expect(watchLine({ state: "watching", checkedAt: foundAt }, reading)).toEqual({
      sub: "Watching ESPN · checked 3:13 PM PT",
      notice: null,
    });
  });

  it.for([
    ["credentials_rejected", "ESPN refused the cookie"],
    ["unreachable", "ESPN couldn't be reached"],
    ["not_connected", "No ESPN cookie yet"],
  ] as const)("says it's paused (%s), why, and that silence means nothing", ([reason, why]) => {
    expect(
      watchLine({ state: "paused", reason, since: espnAt, checkedAt: foundAt }, reading)
    ).toEqual({
      sub: "Paused since 3:12 PM PT",
      notice: `Detection is paused: ${why}, so nothing is being checked. You were emailed. Silence here doesn't mean nothing happened.`,
    });
  });

  it("says it hasn't started", () => {
    expect(watchLine({ state: "not_started" }, reading)).toEqual({
      sub: "Not started",
      notice: "It starts once InjurySub has the ESPN cookie.",
    });
  });
});

// FS-ALERTS-5: the commissioner team's moves, each as one line.
describe("a move on the commissioner's team", () => {
  it("says a lineup move by surname and slots", () => {
    expect(
      moveLine({
        at: espnAt,
        type: "ROSTER",
        byLeagueManager: false,
        items: [
          { type: "LINEUP", player: "Stephen Curry", fromSlot: "G", toSlot: "BE" },
          { type: "LINEUP", player: "Walker Kessler", fromSlot: "BE", toSlot: "G" },
        ],
      })
    ).toBe("Lineup: Curry G → BN, Kessler BN → G");
  });

  it("says a drop and an add by name", () => {
    expect(
      moveLine({
        at: espnAt,
        type: "FREEAGENT",
        byLeagueManager: false,
        items: [
          { type: "DROP", player: "Jae Crowder", fromSlot: null, toSlot: null },
          { type: "ADD", player: "Tari Eason", fromSlot: null, toSlot: null },
        ],
      })
    ).toBe("Drop: Jae Crowder · Add: Tari Eason");
  });

  it("says a league manager made it", () => {
    expect(
      moveLine({
        at: espnAt,
        type: "ROSTER",
        byLeagueManager: true,
        items: [{ type: "LINEUP", player: "Stephen Curry", fromSlot: "G", toSlot: "BN" }],
      })
    ).toBe("Lineup by the league manager: Curry G → BN");
  });
});
