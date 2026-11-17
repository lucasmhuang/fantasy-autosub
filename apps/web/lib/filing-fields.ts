// The on-behalf filing form's answers and what can be wrong with each: the route's JSON answer
// and the form that reads it share them (no server code here, so the client form can import it).

// In the order the form asks them.
export const FILING_FIELDS = [
  "injured",
  "replacement",
  "day",
  "time",
  "replacementGame",
  "enteredPoints",
  "note",
] as const;
export type FilingField = (typeof FILING_FIELDS)[number];

export const FILING_ERROR_CODES = [
  "missing",
  "invalid",
  "future",
  "format",
  "too_long",
  "before_week",
  "after_week",
  "game_had_started",
  "not_final",
  "out_of_range",
] as const;
export type FilingErrorCode = (typeof FILING_ERROR_CODES)[number];

export type FilingFieldError = {
  field: FilingField;
  code: FilingErrorCode;
  // His final line that day, for points above it; when his game tipped, for one that had.
  limitTenths?: number;
  tipAt?: string;
};
