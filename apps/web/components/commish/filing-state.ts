import {
  FILING_ERROR_CODES,
  FILING_FIELDS,
  type FilingField,
  type FilingFieldError,
} from "../../lib/filing-fields";

// The filing form's picks so far: they name its legends and decide which fields show.
export type FilingPicks = {
  injured: string | null;
  replacement: string | null;
  day: string | null;
  game: string | null;
};

export type FilingOutcome =
  | { kind: "navigate"; to: string }
  | {
      kind: "problems";
      errors: Partial<Record<FilingField, FilingFieldError>>;
      refusal: string | null;
      count: number;
    }
  | { kind: "notice"; status: string };

// What the route's answer to the form's fetch, read as far as the form needs it.
export type RouteAnswer = {
  redirected: boolean;
  url: string;
  contentType: string | null;
  body: unknown;
};

const NOTICE_STATUSES = [
  "espn_unreachable",
  "no_matchup",
  "not_on_team",
  "unavailable",
  "invalid_form",
] as const;
const FAILED: FilingOutcome = { kind: "notice", status: "unavailable" };

// Filed: go to the request. Not filed: each problem at its field, the whole form's refusal above
// it. A redirect (signed out) is followed; anything the form can't read is a failure on our side.
export function outcomeOf(answer: RouteAnswer): FilingOutcome {
  if (answer.redirected) return { kind: "navigate", to: answer.url };
  if (!(answer.contentType ?? "").includes("application/json")) return FAILED;
  const body = record(answer.body);
  if (body === null) return FAILED;
  if (body.status === "recorded" && typeof body.location === "string") {
    return { kind: "navigate", to: body.location };
  }
  if (body.status === "not_filed") return problemsOf(body);
  const status = NOTICE_STATUSES.find((each) => each === body.status);
  return status === undefined ? FAILED : { kind: "notice", status };
}

function problemsOf(body: Record<string, unknown>): FilingOutcome {
  const refusal = typeof body.refusal === "string" ? body.refusal : null;
  const errors = Array.isArray(body.errors) ? body.errors.map(fieldErrorOf) : [];
  if (errors.some((error) => error === null)) return FAILED;
  const byField: Partial<Record<FilingField, FilingFieldError>> = {};
  for (const error of errors) if (error !== null) byField[error.field] = error;
  // The answers that need fixing; a refusal of the whole form is said apart (FM-FILE-7).
  return { kind: "problems", errors: byField, refusal, count: Object.keys(byField).length };
}

function fieldErrorOf(value: unknown): FilingFieldError | null {
  const entry = record(value);
  const field = FILING_FIELDS.find((each) => each === entry?.field);
  const code = FILING_ERROR_CODES.find((each) => each === entry?.code);
  if (entry === null || field === undefined || code === undefined) return null;
  return {
    field,
    code,
    ...(typeof entry.limitTenths === "number" ? { limitTenths: entry.limitTenths } : {}),
    ...(typeof entry.tipAt === "string" ? { tipAt: entry.tipAt } : {}),
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? Object.fromEntries(Object.entries(value))
    : null;
}

export function picksOf(form: FormData): FilingPicks {
  const value = (name: string) => {
    const entry = form.get(name);
    return typeof entry === "string" && entry !== "" ? entry : null;
  };
  return {
    injured: value("injured"),
    replacement: value("replacement"),
    day: value("day"),
    game: value("replacementGame"),
  };
}

// Points and the note that backs them are asked only for a game in progress (IF-FILE-2).
export function showsPoints(game: string | null): boolean {
  return game === "in_progress";
}
