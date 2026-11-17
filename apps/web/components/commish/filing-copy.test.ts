import { describe, expect, it } from "vitest";
import {
  designationHint,
  fieldErrorText,
  legendWords,
  problemCount,
  refusalText,
  statusText,
} from "./filing-copy";

const context = {
  manager: "Dana",
  team: "Glass Cannons",
  zone: "America/Los_Angeles",
  week: { number: 4, firstDate: "2026-11-09", lastDate: "2026-11-15" },
};
const picked = { starter: "Joel Embiid", replacement: "Cody Reid", day: "2026-11-11" };
const nothing = { starter: null, replacement: null, day: null };

describe("the filing form's legends (FS-FILE-4, -5)", () => {
  it("names the picks, the manager and the day's weekday once chosen", () => {
    expect(legendWords(picked, context)).toEqual({
      status: "Embiid's status when Dana asked",
      game: "Reid's game when Dana asked",
      inProgress: "Enter his points before Dana asked",
      points: "Reid's points before Dana asked",
      pointsHint: "From his Wednesday line, once that game is final on ESPN.",
      day: "Day Dana asked",
    });
  });

  it("says the starter and the replacement before a pick, and the manager without a name", () => {
    expect(legendWords(nothing, { ...context, manager: null })).toEqual({
      status: "The starter's status when the manager asked",
      game: "The replacement's game when the manager asked",
      inProgress: "Enter his points before the manager asked",
      points: "The replacement's points before the manager asked",
      pointsHint: "From his line that day, once that game is final on ESPN.",
      day: "Day the manager asked",
    });
  });

  it("says what ESPN shows now, read at a time in the reader's zone", () => {
    expect(designationHint("OUT", "2026-11-12T02:39:00Z", context.zone)).toBe(
      "ESPN shows OUT now (Wed 6:39 PM PT). You're attesting what it showed then."
    );
    expect(designationHint("DAY_TO_DAY", "2026-11-12T02:39:00Z", context.zone)).toBe(
      "ESPN shows day-to-day now (Wed 6:39 PM PT). You're attesting what it showed then."
    );
  });
});

describe("the filing form's problems (IF-FILE-4, FM-FILE-3 to -6)", () => {
  it.for([
    [{ field: "time", code: "missing" }, "Enter the time Dana asked."],
    [{ field: "time", code: "invalid" }, "That time doesn't exist on Wed Nov 11 in PT."],
    [{ field: "time", code: "future" }, "That's later than now."],
    [{ field: "time", code: "before_week" }, "That's before week 4 started (Mon Nov 9)."],
    [{ field: "time", code: "after_week" }, "That's after week 4 ended (Sun Nov 15)."],
    [{ field: "day", code: "missing" }, "Choose the day Dana asked."],
    [{ field: "injured", code: "missing" }, "Choose the injured starter."],
    [{ field: "replacement", code: "missing" }, "Choose the replacement."],
    [{ field: "enteredPoints", code: "missing" }, "Enter Reid's points before Dana asked."],
    [{ field: "enteredPoints", code: "format" }, "Enter points like 5.7."],
    [
      { field: "enteredPoints", code: "not_final" },
      "Wednesday isn't final on ESPN yet. File it once his game ends.",
    ],
    [
      { field: "enteredPoints", code: "out_of_range", limitTenths: 180 },
      "Can't be more than Reid's final line for Wed (18.0).",
    ],
    [
      { field: "note", code: "missing" },
      "Add a note backing the points, like the screenshot Dana sent.",
    ],
    [{ field: "note", code: "too_long" }, "Up to 500 characters."],
    [
      { field: "replacementGame", code: "game_had_started", tipAt: "2026-11-12T00:30:00Z" },
      "His game had started by then (4:30 PM PT). Choose In progress and enter his points.",
    ],
  ] as const)("says %o as %s", ([error, text]) => {
    expect(fieldErrorText(error, context, picked)).toBe(text);
  });

  it("counts what needs fixing in words", () => {
    expect(problemCount(1)).toBe("Not filed: one answer needs fixing.");
    expect(problemCount(2)).toBe("Not filed: two answers need fixing.");
  });

  it.for([
    ["active_request_exists", "Glass Cannons already has a request this week for Embiid."],
    [
      "replacement_in_flight",
      "Reid is the replacement in another of Glass Cannons' requests, still in progress.",
    ],
    ["injured_not_starting", "Embiid isn't in Glass Cannons' starting lineup on ESPN now."],
    ["replacement_not_on_bench", "Reid isn't on Glass Cannons' bench on ESPN now."],
    ["replacement_cannot_start", "No valid lineup can take Reid in Embiid's place on ESPN now."],
    ["week_over", "This matchup week is over on ESPN, so it can't take a swap."],
    ["after_final_game", "The week's last game has ended, so no more swaps this week."],
    ["own_team_on_behalf", "That's your own team. File your own from your Team page."],
    ["not_on_team", "Embiid or Reid isn't on Glass Cannons' roster on ESPN now."],
  ] as const)("refuses the whole form for %s: %s", ([code, text]) => {
    expect(refusalText(code, context, picked)).toBe(text);
  });

  it("names a refused player generically before a pick", () => {
    expect(refusalText("active_request_exists", context, nothing)).toBe(
      "Glass Cannons already has a request this week for that starter."
    );
  });
});

describe("the filing form's answers in a notice", () => {
  it.for([
    ["espn_unreachable", "ESPN couldn't be read, so nothing was filed. Try again."],
    ["unavailable", "Something went wrong on our side, and nothing was filed. Try again."],
    ["no_matchup", "Glass Cannons has a bye this week, so there's nothing to file against."],
    ["invalid_form", "Not filed: something in the form wasn't valid. Check it and try again."],
    ["moment_outside_matchup", "Not filed: that moment isn't in this matchup week."],
    [
      "points_needed_mid_game",
      "Not filed: enter his points before the manager asked, with a note.",
    ],
  ] as const)("says %s as %s", ([status, text]) => {
    expect(statusText(status, context.team)).toBe(text);
  });

  it("leaves a code it doesn't know to the commissioner's own messages", () => {
    expect(statusText("acknowledged", context.team)).toBeNull();
  });
});
