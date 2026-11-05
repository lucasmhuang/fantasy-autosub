import { AppError } from "@injurysub/config";

export type DatabaseErrorCode = "connect_failed";

// A database failure that isn't a failed query. Its cause is pg's own error. The code is lowercase,
// unlike pg's and Node's, so describeFailure skips it and reports the cause's code (ECONNREFUSED,
// 28P01) or the label of pg's message.
export class DatabaseError extends AppError {
  override readonly name = "DatabaseError";
  readonly code: DatabaseErrorCode;

  constructor(code: DatabaseErrorCode, message: string, options: { cause?: Error } = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.code = code;
  }
}
