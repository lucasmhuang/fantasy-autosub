import type { GameState, ProGame } from "@injurysub/espn";
import { describe, expect, it } from "vitest";
import {
  commissionerWord,
  dayChangeNote,
  gameText,
  headlineSentence,
  nextGameLine,
  noTeamCopy,
  optionCountLine,
  readyGroupLabel,
  requestPill,
  sideToday,
  signedPoints,
  startingDayText,
  weekLabel,
} from "./board-copy";

const PT = "America/Los_Angeles";
const ET = "America/New_York";

const game = (fields: Partial<ProGame> = {}): ProGame => ({
  scoringPeriodId: 8,
  date: "2026-10-28T02:00:00.000Z",
  opponentProTeamId: 23,
  opponent: "SAC",
  home: true,
  ...fields,
});

const state = (fields: Partial<GameState>): GameState => ({
  homeProTeamId: 9,
  awayProTeamId: 23,
  tip: "2026-10-28T02:00:00.000Z",
  phase: "scheduled",
  period: 0,
  clock: "0.0",
  ...fields,
});

describe("commissionerWord", () => {
  it("names the commissioner by first name, else says the commissioner, capitalised to start a sentence", () => {
    expect(commissionerWord("Sam Lee")).toBe("Sam");
    expect(commissionerWord(null)).toBe("the commissioner");
    expect(commissionerWord(null, true)).toBe("The commissioner");
    expect(commissionerWord("  ")).toBe("the commissioner");
  });
});

describe("weekLabel", () => {
  it("says the week by number and its Monday to Sunday, and a playoff week as such", () => {
    const week = {
      matchupPeriodId: 4,
      playoffs: false,
      firstDate: "2026-11-09",
      lastDate: "2026-11-15",
    };

    expect(weekLabel(week)).toBe("Week 4 · Mon Nov 9 – Sun Nov 15");
    expect(weekLabel({ ...week, matchupPeriodId: 19, playoffs: true })).toBe(
      "Playoffs · Week 19 · Mon Nov 9 – Sun Nov 15"
    );
    expect(weekLabel({ ...week, firstDate: null })).toBe("Week 4");
  });
});

describe("sideToday", () => {
  it("labels today's points as live, plain when the read is stale, and none before any game", () => {
    expect(sideToday({ livePoints: 110.5 }, { stale: false, beforeFirstGame: false })).toBe(
      "+110.5 today, live"
    );
    expect(sideToday({ livePoints: 71 }, { stale: true, beforeFirstGame: false })).toBe(
      "+71.0 today"
    );
    expect(
      sideToday({ livePoints: null }, { stale: false, beforeFirstGame: false })
    ).toBeUndefined();
    expect(sideToday({ livePoints: null }, { stale: false, beforeFirstGame: true })).toBe(
      "No games yet"
    );
  });
});

describe("headlineSentence", () => {
  const base = {
    outCount: 1,
    suspendedCount: 0,
    playoffs: false,
    beforeFirstGame: false,
    onlyStarterHasRequest: false,
  };

  it("says what can be done for each case, the commissioner named", () => {
    expect(headlineSentence(base, "Sam")).toBeNull();
    // Copy table 2: the card already says these.
    expect(headlineSentence({ ...base, outCount: 2 }, "Sam")).toBeNull();
    expect(headlineSentence({ ...base, onlyStarterHasRequest: true }, "Sam")).toBeNull();
    expect(headlineSentence({ ...base, beforeFirstGame: true }, "Sam")).toBe(
      "It's before his first game, so a swap forfeits nothing."
    );
    expect(headlineSentence({ ...base, playoffs: true }, "Sam")).toBe(
      "In playoff weeks Sam settles every request. You can still ask."
    );
    expect(headlineSentence({ ...base, outCount: 0, suspendedCount: 1 }, "Sam")).toBe(
      "You can still ask; Sam decides."
    );
    expect(headlineSentence({ ...base, outCount: 0 }, "Sam")).toBe(
      "ESPN can take a few minutes to show a new OUT."
    );
  });
});

describe("gameText", () => {
  it("gives today's game its state from the scoreboard, quarter included", () => {
    const today = game();

    expect(
      gameText(
        { todaysGame: today, nextGame: today, gameState: state({ phase: "live", period: 3 }) },
        PT
      )
    ).toEqual({
      text: "Live, Q3 vs SAC",
      live: true,
    });
    expect(
      gameText(
        { todaysGame: today, nextGame: today, gameState: state({ phase: "live", period: 5 }) },
        PT
      ).text
    ).toBe("Live, OT vs SAC");
    expect(
      gameText(
        {
          todaysGame: { ...today, home: false },
          nextGame: null,
          gameState: state({ phase: "final" }),
        },
        PT
      )
    ).toEqual({ text: "Final @ SAC", live: false });
  });

  it("falls back to the tip time when the scoreboard isn't read or the game hasn't started", () => {
    const today = game();

    expect(gameText({ todaysGame: today, nextGame: today, gameState: null }, PT)).toEqual({
      text: "7:00 PM PT vs SAC",
      live: false,
    });
    expect(gameText({ todaysGame: today, nextGame: today, gameState: null }, ET).text).toBe(
      "10:00 PM ET vs SAC"
    );
  });

  it("names the next game's weekday when there's none today, and says when none is left", () => {
    expect(
      gameText(
        { todaysGame: null, nextGame: game({ date: "2026-10-30T02:00:00.000Z" }), gameState: null },
        PT
      )
    ).toEqual({
      text: "next Thu",
      live: false,
    });
    expect(gameText({ todaysGame: null, nextGame: null, gameState: null }, PT)).toEqual({
      text: "No games left",
      live: false,
    });
  });
});

describe("nextGameLine", () => {
  it("says the OUT starter's next game, or his first before any points", () => {
    const next = game({ date: "2026-10-30T02:00:00.000Z", home: false });

    expect(nextGameLine(next, false, PT)).toBe("Next game Thu 7:00 PM PT @ SAC");
    expect(nextGameLine(next, true, PT)).toBe("First game Thu 7:00 PM PT @ SAC");
    expect(nextGameLine(null, false, PT)).toBe("No games left this week");
  });
});

describe("startingDayText and signedPoints", () => {
  it("writes a day's points by its weekday, and an amount with its sign", () => {
    expect(startingDayText({ scoringPeriodId: 7, date: "2026-10-26", points: 46.5 })).toBe(
      "Mon 46.5"
    );
    expect(signedPoints(-878)).toBe("−87.8");
    expect(signedPoints(51)).toBe("+5.1");
    expect(signedPoints(null)).toBe("—");
  });
});

describe("optionCountLine and readyGroupLabel", () => {
  it("counts the options each way, as the league's mode routes them", () => {
    expect(optionCountLine({ readyNow: 3, review: 1, notValid: 2 }, "now", "Sam")).toBe(
      "3 ready now, 1 more Sam decides"
    );
    expect(optionCountLine({ readyNow: 2, review: 0, notValid: 0 }, "now", "Sam")).toBe(
      "2 ready now"
    );
    expect(optionCountLine({ readyNow: 2, review: 1, notValid: 0 }, "approval", "Sam")).toBe(
      "2 ready once Sam approves, 1 more Sam decides"
    );
    expect(optionCountLine({ readyNow: 2, review: 1, notValid: 0 }, "commissioner", "Sam")).toBe(
      "3 Sam decides"
    );
    expect(optionCountLine({ readyNow: 0, review: 2, notValid: 0 }, "now", "Sam")).toBe(
      "2 Sam decides"
    );
    expect(readyGroupLabel("now", "Sam")).toBe("Ready now");
    expect(readyGroupLabel("approval", "Sam")).toBe("Ready once Sam approves");
    expect(readyGroupLabel("commissioner", "Sam")).toBe("Sam makes it");
  });
});

describe("requestPill", () => {
  it("gives every request status the canvas's word and kind, the commissioner named", () => {
    expect(requestPill("queued", "Sam")).toEqual({ kind: "in-line", word: "In line" });
    expect(requestPill("executing", "Sam")).toEqual({ kind: "in-progress", word: "In progress" });
    expect(requestPill("awaiting_approval", "Sam")).toEqual({
      kind: "waiting",
      word: "Waiting for Sam",
    });
    expect(requestPill("needs_review", "Sam")).toEqual({
      kind: "waiting",
      word: "Waiting for Sam",
    });
    expect(requestPill("completed", "Sam")).toEqual({ kind: "done", word: "Done" });
    expect(requestPill("completed_manually", "Sam")).toEqual({
      kind: "done",
      word: "Settled by hand",
    });
    expect(requestPill("rejected", "Sam")).toEqual({ kind: "stopped", word: "Rejected" });
    expect(requestPill("refused", "Sam")).toEqual({ kind: "stopped", word: "Refused" });
    expect(requestPill("withdrawn", "Sam")).toEqual({ kind: "undone", word: "Withdrawn" });
    expect(requestPill("reversed", "Sam")).toEqual({ kind: "undone", word: "Reversed" });
    expect(requestPill("needs_review", "the commissioner")).toEqual({
      kind: "waiting",
      word: "Waiting for the commissioner",
    });
  });
});

describe("noTeamCopy", () => {
  it("says why there's no team to show, never calling InjurySub's outage ESPN's", () => {
    expect(noTeamCopy("credentials_rejected", "Sam")).toEqual({
      title: "Can't read ESPN",
      sentence:
        "ESPN refused the league's cookie; Sam knows. No new requests until it's renewed; earlier ones wait. Starter ruled OUT? Text Sam; they can file it with the time you asked.",
      retry: false,
    });
    expect(noTeamCopy("not_connected", "Sam")).toEqual({
      title: "No ESPN cookie yet",
      sentence: "Sam adds it before requests open.",
      retry: false,
    });
    expect(noTeamCopy("worker_down", "Sam")).toEqual({
      title: "Can't load your team right now",
      sentence:
        "Requests in line wait. Starter ruled OUT? Text Sam; they can file it with the time you asked.",
      retry: true,
    });
    expect(noTeamCopy("unavailable", "Sam")).toEqual({
      title: "Can't reach ESPN right now",
      sentence: "Starter ruled OUT? Text Sam; they can file it with the time you asked.",
      retry: true,
    });
    expect(noTeamCopy("no_team", null)).toEqual({
      title: "No team yet",
      sentence: "Ask the commissioner to set your team.",
      retry: false,
    });
    expect(noTeamCopy("season_over", "Sam")).toMatchObject({ title: "Season over", sentence: "" });
    expect(noTeamCopy("database_down", "Sam").title).toBe("Can't load InjurySub right now");
  });
});

describe("dayChangeNote", () => {
  it("says when ESPN's day ends in the reader's zone, midnight in Pacific", () => {
    const evening = new Date("2026-11-16T05:00:00.000Z");

    expect(dayChangeNote(evening, PT)).toBe(
      "ESPN's day ends at midnight PT; it can still correct stats after that."
    );
    expect(dayChangeNote(evening, ET)).toBe(
      "ESPN's day ends at 3:00 AM ET; it can still correct stats after that."
    );
  });
});
