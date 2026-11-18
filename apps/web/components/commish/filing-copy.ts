import { espnDayLabel, formatMoment } from "@injurysub/domain";
import type { FilingFieldError } from "../../lib/filing-fields";
import { surname } from "../board/option-copy";

// What the filing form's words are about: whose request, for which team, in which week, read in
// which zone.
export type FilingCopyContext = {
  manager: string | null;
  team: string;
  zone: string;
  week: { number: number; firstDate: string; lastDate: string };
};

// The players and the day picked so far, by name and ISO date.
export type FilingPicked = {
  starter: string | null;
  replacement: string | null;
  day: string | null;
};

// The page's line under its title; its loading state shows it too.
export const FILING_SUB =
  "For a manager who asked you directly, by text say. Not for your own team.";

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight"];

function asker(manager: string | null): string {
  return manager ?? "the manager";
}

function possessive(name: string): string {
  return name.endsWith("s") ? `${name}'` : `${name}'s`;
}

function playerWord(name: string | null, fallback: string): string {
  return name === null ? fallback : surname(name);
}

function longWeekday(isoDate: string): string {
  const [year = 0, month = 1, day = 1] = isoDate.split("-").map(Number);
  const noon = new Date(Date.UTC(year, month - 1, day, 12));
  return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(noon);
}

function shortWeekday(isoDate: string): string {
  return espnDayLabel(isoDate).split(" ")[0] ?? "";
}

// The legends and hints that name the picks once made (FS-FILE-3 to -5).
export function legendWords(picked: FilingPicked, context: Pick<FilingCopyContext, "manager">) {
  const who = asker(context.manager);
  const starter = playerWord(picked.starter, "The starter");
  const replacement = playerWord(picked.replacement, "The replacement");
  const line = picked.day === null ? "his line that day" : `his ${longWeekday(picked.day)} line`;
  return {
    status: `${possessive(starter)} status when ${who} asked`,
    game: `${possessive(replacement)} game when ${who} asked`,
    inProgress: `Enter his points before ${who} asked`,
    points: `${possessive(replacement)} points before ${who} asked`,
    pointsHint: `From ${line}, once that game is final on ESPN.`,
    day: `Day ${who} asked`,
  };
}

const DESIGNATION_WORDS: Record<string, string> = {
  OUT: "OUT",
  SUSPENSION: "suspended",
  DAY_TO_DAY: "day-to-day",
  ACTIVE: "active",
};

// What ESPN shows of the starter, around the read's time, which the form keeps current
// (FS-TIME-8).
export function designationHint(
  designation: string,
  readAt: string,
  zone: string
): { before: string; time: string; after: string } {
  const shows = DESIGNATION_WORDS[designation] ?? designation.toLowerCase().replaceAll("_", " ");
  return {
    before: `ESPN shows ${shows} now (`,
    time: formatMoment(new Date(readAt), zone, "weekday"),
    after: "). You're attesting what it showed then.",
  };
}

type ErrorWords = {
  who: string;
  replacement: string;
  day: string | null;
  context: FilingCopyContext;
  error: FilingFieldError;
};

// Each problem at its field (IF-FILE-4, FM-FILE-3 to -6; Revision 3's G for the undrawn ones).
const FIELD_SENTENCES: Record<string, (words: ErrorWords) => string> = {
  "time.missing": ({ who }) => `Enter the time ${who} asked.`,
  "time.invalid": ({ day, context }) =>
    day === null
      ? "That time doesn't exist that day."
      : `That time doesn't exist on ${espnDayLabel(day)} in ${zoneWord(context.zone, day)}.`,
  "time.future": () => "That's later than now.",
  "time.before_week": ({ context: { week } }) =>
    `That's before week ${week.number} started (${espnDayLabel(week.firstDate)}).`,
  "time.after_week": ({ context: { week } }) =>
    `That's after week ${week.number} ended (${espnDayLabel(week.lastDate)}).`,
  "injured.missing": () => "Choose the injured starter.",
  "replacement.missing": () => "Choose the replacement.",
  "enteredPoints.missing": ({ who, replacement }) =>
    `Enter ${possessive(replacement)} points before ${who} asked.`,
  "enteredPoints.format": () => "Enter points like 5.7.",
  "enteredPoints.not_final": ({ day }) =>
    `${day === null ? "That day" : longWeekday(day)} isn't final on ESPN yet. File it once his game ends.`,
  "enteredPoints.out_of_range": ({ replacement, day, error }) =>
    `Can't be more than ${possessive(replacement)} final line for ${day === null ? "that day" : shortWeekday(day)} (${tenths(error.limitTenths)}).`,
  "note.missing": ({ who }) => `Add a note backing the points, like the screenshot ${who} sent.`,
  "note.too_long": () => "Up to 500 characters.",
  "replacementGame.game_had_started": ({ error, context }) =>
    `His game had started by then${tipWords(error.tipAt, context.zone)}. Choose In progress and enter his points.`,
};

export function fieldErrorText(
  error: FilingFieldError,
  context: FilingCopyContext,
  picked: FilingPicked
): string {
  const who = asker(context.manager);
  const words = {
    who,
    replacement: playerWord(picked.replacement, "the replacement"),
    day: picked.day,
    context,
    error,
  };
  const sentence = FIELD_SENTENCES[`${error.field}.${error.code}`];
  return sentence === undefined ? `Choose the day ${who} asked.` : sentence(words);
}

function zoneWord(zone: string, isoDate: string): string {
  return (
    formatMoment(new Date(`${isoDate}T12:00:00Z`), zone, "time")
      .split(" ")
      .at(-1) ?? zone
  );
}

function tenths(value: number | undefined): string {
  return value === undefined ? "his final line" : (value / 10).toFixed(1);
}

function tipWords(tipAt: string | undefined, zone: string): string {
  return tipAt === undefined ? "" : ` (${formatMoment(new Date(tipAt), zone, "time")})`;
}

export function problemCount(count: number): string {
  const word = NUMBER_WORDS[count] ?? String(count);
  return count === 1
    ? `Not filed: ${word} answer needs fixing.`
    : `Not filed: ${word} answers need fixing.`;
}

// A refusal of the whole form, in the commissioner's words (FM-FILE-7; adapted from the manager's
// own sentences with the team's name for "your").
export function refusalText(
  code: string,
  context: Pick<FilingCopyContext, "team">,
  picked: FilingPicked
): string | null {
  const team = context.team;
  const starter = playerWord(picked.starter, "that starter");
  const replacement = playerWord(picked.replacement, "that player");
  const refusals: Record<string, string> = {
    active_request_exists: `${team} already has a request this week for ${starter}.`,
    replacement_in_flight: `${capitalized(replacement)} is the replacement in another of ${possessive(team)} requests, still in progress.`,
    injured_not_starting: `${capitalized(starter)} isn't in ${possessive(team)} starting lineup on ESPN now.`,
    replacement_not_on_bench: `${capitalized(replacement)} isn't on ${possessive(team)} bench on ESPN now.`,
    replacement_cannot_start: `No valid lineup can take ${replacement} in ${possessive(starter)} place on ESPN now.`,
    week_over: "This matchup week is over on ESPN, so it can't take a request.",
    after_final_game: "The week's last game has ended, so no more requests this week.",
    own_team_on_behalf: "That's your own team. File your own from your Team page.",
    not_on_team: `${capitalized(starter)} or ${replacement} isn't on ${possessive(team)} roster on ESPN now.`,
  };
  return refusals[code] ?? null;
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// The answer's own notice: with script, a status the route gave instead of problems; without,
// the one sentence the plain post came back with. Null for a code that isn't the filing's.
export function statusText(status: string, team: string): string | null {
  const nothing = { starter: null, replacement: null, day: null };
  const notices: Record<string, string> = {
    espn_unreachable: "ESPN couldn't be read, so nothing was filed. Try again.",
    unavailable: "Something went wrong, and nothing was filed. Try again.",
    no_matchup: `${team} has a bye this week, so there's nothing to file against.`,
    invalid_form: "Not filed: something in the form wasn't valid. Check it and try again.",
    moment_outside_matchup: "Not filed: that moment isn't in this matchup week.",
    points_needed_mid_game: "Not filed: enter his points before the manager asked, with a note.",
    game_had_started: "Not filed: the replacement's game had already started at that moment.",
    hand_entry_needs_final_line:
      "Not filed: his day isn't final on ESPN yet. File it once his game ends.",
    hand_entry_out_of_range: "Not filed: the points entered are more than his final line that day.",
  };
  if (Object.hasOwn(notices, status)) return notices[status] ?? null;
  const refusal = refusalText(status, { team }, nothing);
  return refusal === null ? null : `Not filed: ${refusal}`;
}
