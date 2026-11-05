import { AppError } from "@injurysub/config";

export type DatabaseErrorCode = "connect_failed" | "conflict_unresolved";

// A database failure that isn't a failed query: a transaction that couldn't open a connection
// (its cause is pg's own error), or a repeated insert whose matching row vanished. The code is
// lowercase, unlike pg's and Node's, so describeFailure skips it and reports the cause's code
// (ECONNREFUSED, 28P01) or the label of pg's message; with no cause it gives "unknown".
export class DatabaseError extends AppError {
  override readonly name = "DatabaseError";
  readonly code: DatabaseErrorCode;

  constructor(code: DatabaseErrorCode, message: string, options: { cause?: Error } = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.code = code;
  }
}
