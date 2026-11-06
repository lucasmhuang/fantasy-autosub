import { AppError } from "@injurysub/config";

export type WorkerStartupErrorCode = "invalid_setting";

// A setting the worker can't start with. The message names the setting, never its value.
export class WorkerStartupError extends AppError {
  override readonly name = "WorkerStartupError";
  readonly code: WorkerStartupErrorCode = "invalid_setting";
}
