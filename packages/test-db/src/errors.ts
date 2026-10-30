import { AppError } from "@injurysub/config";

export type TestDatabaseErrorCode =
  | "docker_unavailable"
  | "docker_command_failed"
  | "container_failed"
  | "not_a_database_test";

// The database test harness's own failures: Docker isn't running, a docker command failed, the test
// server didn't start, or a test asked for a database outside the database test files. Each message
// says what happened, with docker's or the server's own words where there are any.
export class TestDatabaseError extends AppError {
  override readonly name = "TestDatabaseError";
  readonly code: TestDatabaseErrorCode;

  constructor(code: TestDatabaseErrorCode, message: string, options: { cause?: Error } = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.code = code;
  }
}
