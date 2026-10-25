import { AppError } from "@injurysub/config";

export type EspnErrorCode =
  | "espn_unavailable"
  | "credentials_rejected"
  | "league_not_found"
  | "season_not_in_progress"
  | "team_not_found"
  | "unrecognized_response"
  | "not_recorded";

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
