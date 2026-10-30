import { AppError } from "@injurysub/config";

export type SeedErrorCode =
  | "path_not_absolute"
  | "database_url_unsupported"
  | "tls_unspecified"
  | "file_unreadable"
  | "file_invalid"
  | "database_unreachable"
  | "schema_missing"
  | "schema_outdated"
  | "schema_ahead";

// The account seed refusing to go on. The message names the step, never a value. `reason` is a safe
// code: a fixed label, or the code of the database or file failure underneath. That failure is
// never kept as the cause, since its text could hold an address, a name or the database password.
export class SeedError extends AppError {
  override readonly name = "SeedError";
  readonly code: SeedErrorCode;
  readonly reason: string;

  constructor(code: SeedErrorCode, message: string, reason: string) {
    super(message);
    this.code = code;
    this.reason = reason;
  }
}
