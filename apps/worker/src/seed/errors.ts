import { AppError } from "@injurysub/config";

export type SeedErrorCode =
  | "path_not_absolute"
  | "tls_unspecified"
  | "file_unreadable"
  | "file_invalid"
  | "database_unreachable"
  | "schema_missing"
  | "schema_outdated"
  | "schema_ahead";

// The account seed refusing to go on. The message names the step, never a value. A database or
// file failure underneath is described by `reason`, a safe code, and is never kept as the cause:
// its text could hold an address, a name or the database's password.
export class SeedError extends AppError {
  override readonly name = "SeedError";
  readonly code: SeedErrorCode;
  readonly reason: string | undefined;

  constructor(code: SeedErrorCode, message: string, options: { reason?: string } = {}) {
    super(message);
    this.code = code;
    this.reason = options.reason;
  }
}
