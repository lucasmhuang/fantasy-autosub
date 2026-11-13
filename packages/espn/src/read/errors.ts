import { AppError } from "@injurysub/config";

export const espnErrorCodes = [
  "espn_unavailable",
  "credentials_rejected",
  "league_not_found",
  "season_not_in_progress",
  "team_not_found",
  "unrecognized_response",
  "not_recorded",
  "not_connected",
  // The web couldn't get an answer from the worker that reads ESPN for it.
  "worker_unreachable",
  // ESPN answered a write with a refusal, so it didn't apply.
  "write_refused",
  // A write went out and no usable answer came back (a deadline, a dropped connection, a 5xx
  // other than 503): it may have applied, and only a read of ESPN can tell.
  "outcome_unknown",
] as const;
export type EspnErrorCode = (typeof espnErrorCodes)[number];

export function isEspnErrorCode(value: string): value is EspnErrorCode {
  return (espnErrorCodes as readonly string[]).includes(value);
}

// Every failed ESPN read throws one. `code` tells the caller what to do about it: refresh the
// credentials, try again later, fix the configuration, or treat the data as unreadable. Messages
// name the read, never the league id or a cookie.
export class EspnError extends AppError {
  override readonly name = "EspnError";
  readonly code: EspnErrorCode;
  readonly status: number | undefined;

  constructor(
    code: EspnErrorCode,
    message: string,
    options: { status?: number; cause?: Error } = {}
  ) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.code = code;
    this.status = options.status;
  }
}
