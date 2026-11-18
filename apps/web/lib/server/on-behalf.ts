import {
  canonicalZone,
  PACIFIC,
  parseMomentInZone,
  type RequestEvaluation,
  type RequestRefusalReason,
  toTenths,
} from "@injurysub/domain";
import { FILING_FIELDS, type FilingErrorCode, type FilingFieldError } from "../filing-fields";
import { readTeamWeek } from "./board";
import { LEAGUE_TEAM_IDS } from "./commish-settings";
import { pacificDaysBetween } from "./pacific-time";
import {
  type Attestation,
  dayTenths,
  evaluateFiling,
  IDEMPOTENCY_KEY,
  recordOnBehalfFiling,
  rosteredPlayer,
  type Submission,
  tipOn,
} from "./requests";

export type OnBehalfResult =
  | { status: "invalid_form" | "espn_unreachable" | "no_matchup" | "not_on_team" | "unavailable" }
  | { status: "recorded"; requestId: string }
  | { status: "not_filed"; errors: FilingFieldError[]; refusal: RequestRefusalReason | null };

const DESIGNATIONS = ["OUT", "SUSPENSION"] as const;
const GAME_STATES = ["not_started", "ended", "in_progress"] as const;
const PLAYER_ID = /^\d{1,12}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;
const POINTS = /^\d{1,3}(\.\d)?$/;
const MAX_NOTE_LENGTH = 500;

// ESPN's refusals that belong to one answer; every other is the whole form's.
const FIELD_REFUSALS: Partial<Record<RequestRefusalReason, FilingFieldError>> = {
  game_had_started: { field: "replacementGame", code: "game_had_started" },
  points_needed_mid_game: { field: "enteredPoints", code: "missing" },
  hand_entry_needs_final_line: { field: "enteredPoints", code: "not_final" },
  hand_entry_out_of_range: { field: "enteredPoints", code: "out_of_range" },
};

// The commissioner files a request a manager made outside the app, at the moment they state
// (Q16, Dec-D22). It's judged at that moment on the commissioner's attestation, never for their
// own team, and then follows the same gates as any request. Every problem one post can know comes
// back together, and a filing with any records nothing (IF-FILE-4, SC-FILE-2).
export async function fileOnBehalfRequest(input: {
  user: { userId: string; role: "manager" | "commissioner"; teamId: number | null };
  form: FormData;
  now: Date;
}): Promise<OnBehalfResult> {
  const parsed = parseFiling(input.form, input.now);
  if (parsed === null) return { status: "invalid_form" };
  const { teamId, ids, moment, attestation, errors } = parsed;
  if (ids === null || moment === null) return notFiled(errors, null);

  const read = await readTeamWeek(teamId);
  if ("status" in read) return { status: "espn_unreachable" };
  if (read.matchup === null) return { status: "no_matchup" };
  const injured = rosteredPlayer(read, ids.injuredId);
  const replacement = rosteredPlayer(read, ids.replacementId);
  if (injured === null || replacement === null) return { status: "not_on_team" };
  // ESPN's day changes at midnight Pacific: the moment's day is today's less the Pacific days
  // since.
  const requestDay = read.week.todayScoringPeriodId - pacificDaysBetween(moment, input.now);
  const outside = outsideWeek(requestDay, read.week.scoringPeriodIds);
  if (outside !== null) return notFiled([...errors, { field: "time", code: outside }], null);

  const filing = { kind: "on_behalf" as const, teamId, moment, requestDay, attestation };
  const submission: Submission = {
    ...{ user: input.user, now: input.now, ids, read, matchup: read.matchup },
    ...{ injured, replacement, filing, shownEdit: null },
  };
  const detail = detailOf(submission);
  if (errors.length > 0) {
    return withEvaluation(errors, await evaluateFiling(submission), detail);
  }
  return answerOf(await recordOnBehalfFiling(submission), detail);
}

type Detail = (error: FilingFieldError) => FilingFieldError;

// What the sentence at a field needs from ESPN's read: his final line that day, or his tip.
function detailOf({ read, ids, filing }: Submission): Detail {
  return (error) => {
    if (error.code === "out_of_range") {
      return { ...error, limitTenths: dayTenths(read, ids.replacementId, filing.requestDay) };
    }
    const tip = tipOn(read, ids.replacementId, filing.requestDay);
    if (error.code === "game_had_started" && tip !== null) {
      return { ...error, tipAt: tip.toISOString() };
    }
    return error;
  };
}

function outsideWeek(requestDay: number, days: readonly number[]): FilingErrorCode | null {
  if (requestDay < Math.min(...days)) return "before_week";
  if (requestDay > Math.max(...days)) return "after_week";
  return null;
}

function withEvaluation(
  errors: FilingFieldError[],
  evaluation: RequestEvaluation | { status: "unavailable" },
  detail: Detail
): OnBehalfResult {
  if ("status" in evaluation) return evaluation;
  if (evaluation.outcome !== "refused") return notFiled(errors, null);
  return refusedWith(errors, evaluation.reason, detail);
}

function answerOf(
  result: Awaited<ReturnType<typeof recordOnBehalfFiling>>,
  detail: Detail
): OnBehalfResult {
  switch (result.status) {
    case "recorded":
      return { status: "recorded", requestId: result.requestId };
    case "not_filed":
    case "refused":
      return refusedWith([], result.reason, detail);
    // A filing shows no edit and names no matchup period, so neither can change under it.
    case "edit_changed":
    case "week_changed":
      return { status: "unavailable" };
    default:
      return { status: result.status };
  }
}

function refusedWith(
  errors: FilingFieldError[],
  reason: RequestRefusalReason,
  detail: Detail
): OnBehalfResult {
  const field = FIELD_REFUSALS[reason];
  if (field === undefined) return notFiled(errors, reason);
  return notFiled([...errors, detail(field)], null);
}

// One problem per answer, the form's own first, in the form's order.
function notFiled(
  errors: FilingFieldError[],
  refusal: RequestRefusalReason | null
): OnBehalfResult {
  const firsts = errors.filter(
    (error, index) => errors.findIndex((each) => each.field === error.field) === index
  );
  const order = (error: FilingFieldError) => FILING_FIELDS.indexOf(error.field);
  return { status: "not_filed", errors: firsts.sort((a, b) => order(a) - order(b)), refusal };
}

type ParsedFiling = {
  teamId: number;
  ids: Submission["ids"] | null;
  moment: Date | null;
  attestation: Attestation;
  errors: FilingFieldError[];
};

// The form's answers and what's wrong with each. Null for what the form never offers (a team
// outside the league, an unknown zone, designation or game state, a malformed key): that post
// didn't come from the form.
function parseFiling(form: FormData, now: Date): ParsedFiling | null {
  const teamId = Number(form.get("team"));
  const key = form.get("idempotencyKey");
  const zone = postedZone(form);
  const designation = DESIGNATIONS.find((each) => each === form.get("designation"));
  const replacementGame = GAME_STATES.find((state) => state === form.get("replacementGame"));
  if (!LEAGUE_TEAM_IDS.includes(teamId) || typeof key !== "string" || !IDEMPOTENCY_KEY.test(key)) {
    return null;
  }
  if (zone === null || replacementGame === undefined) return null;
  if (designation === undefined) return null;

  const injured = playerAnswer(form, "injured");
  const replacement = playerAnswer(form, "replacement");
  if (injured === "invalid" || replacement === "invalid") return null;
  const when = momentAnswer(form, zone, now);
  const points = pointsAnswer(form, replacementGame);
  const errors: FilingFieldError[] = [
    ...(injured === null ? [{ field: "injured" as const, code: "missing" as const }] : []),
    ...(replacement === null ? [{ field: "replacement" as const, code: "missing" as const }] : []),
    ...when.errors,
    ...points.errors,
  ];
  const ids =
    injured === null || replacement === null
      ? null
      : { injuredId: injured, replacementId: replacement, idempotencyKey: key };
  const attestation = { designation, replacementGame, ...points.answer };
  return { teamId, ids, moment: when.moment, attestation, errors };
}

function playerAnswer(form: FormData, field: "injured" | "replacement"): number | null | "invalid" {
  const value = form.get(field);
  if (value === null || value === "") return null;
  return typeof value === "string" && PLAYER_ID.test(value) ? Number(value) : "invalid";
}

// The day and the time, read together in the posted zone.
function momentAnswer(
  form: FormData,
  zone: string,
  now: Date
): { moment: Date | null; errors: FilingFieldError[] } {
  const day = text(form, "day");
  const time = text(form, "time");
  const errors: FilingFieldError[] = [
    ...(day === "" ? [{ field: "day" as const, code: "missing" as const }] : []),
    ...(day !== "" && !DAY.test(day) ? [{ field: "day" as const, code: "invalid" as const }] : []),
    ...(time === "" ? [{ field: "time" as const, code: "missing" as const }] : []),
  ];
  if (errors.length > 0) return { moment: null, errors };
  if (!TIME.test(time)) return { moment: null, errors: [{ field: "time", code: "invalid" }] };
  return checkedMoment(parseMomentInZone(`${day}T${time}`, zone), now);
}

function checkedMoment(
  moment: Date | null,
  now: Date
): { moment: Date | null; errors: FilingFieldError[] } {
  if (moment === null) return { moment: null, errors: [{ field: "time", code: "invalid" }] };
  if (moment.getTime() > now.getTime()) {
    return { moment: null, errors: [{ field: "time", code: "future" }] };
  }
  return { moment, errors: [] };
}

// Hand-entered points are for a game in progress only, where they're required with the note
// that backs them (a screenshot, say). For any other game the form hides both, and whatever was
// typed before goes unused.
function pointsAnswer(
  form: FormData,
  replacementGame: Attestation["replacementGame"]
): { answer: Pick<Attestation, "enteredTenths" | "note">; errors: FilingFieldError[] } {
  if (replacementGame !== "in_progress") {
    return { answer: { enteredTenths: null, note: null }, errors: [] };
  }
  const entered = text(form, "enteredPoints");
  // A browser sends each line break as CRLF but counts it as one character against maxLength.
  const note = text(form, "note").replaceAll("\r\n", "\n");
  const errors: FilingFieldError[] = [
    ...(entered === "" ? [{ field: "enteredPoints" as const, code: "missing" as const }] : []),
    ...(entered !== "" && !POINTS.test(entered)
      ? [{ field: "enteredPoints" as const, code: "format" as const }]
      : []),
    ...(note === "" ? [{ field: "note" as const, code: "missing" as const }] : []),
    ...(note.length > MAX_NOTE_LENGTH
      ? [{ field: "note" as const, code: "too_long" as const }]
      : []),
  ];
  const enteredTenths = POINTS.test(entered) ? toTenths(Number(entered)) : null;
  return { answer: { enteredTenths, note: note === "" ? null : note }, errors };
}

function text(form: FormData, field: string): string {
  const value = form.get(field);
  return typeof value === "string" ? value.trim() : "";
}

// The zone the form's label named the typed time in. A form from before it named one said
// "Pacific time" and posts none.
function postedZone(form: FormData): string | null {
  const zone = form.get("zone");
  if (zone === null) return PACIFIC;
  return typeof zone === "string" ? canonicalZone(zone) : null;
}
