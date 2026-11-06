import {
  AppError,
  createLogger,
  isRemoteUrl,
  resolveDeploymentMode,
  serverEnvSchema,
} from "@injurysub/config";

// The settings to check: process.env, or a test's own.
type SettingsSource = Record<string, string | undefined>;

// The web app's settings are unusable: on a hosted deployment, development defaults count.
export class StartupConfigError extends AppError {
  override readonly name = "StartupConfigError";
  readonly code = "invalid_env";
}

// The shared settings plus the web's own hosted check. The worker loads the shared schema too, and
// its own WORKER_INTERNAL_URL is never read, so the check lives here: a hosted web left on the
// local default would otherwise start and fail every ESPN read as worker_unreachable.
const webEnvSchema = serverEnvSchema.superRefine((env, context) => {
  if (resolveDeploymentMode(env) === "hosted" && !isRemoteUrl(env.WORKER_INTERNAL_URL)) {
    context.addIssue({
      code: "custom",
      path: ["WORKER_INTERNAL_URL"],
      message: "WORKER_INTERNAL_URL must name the worker's private address.",
    });
  }
});

// Checks the settings once, at server start. On failure it logs each bad setting's name and
// problem, never its value, and throws. It logs through its own logger, since the web logger
// would parse the same settings.
export function validateWebEnvironment(source: SettingsSource = process.env): void {
  const result = webEnvSchema.safeParse(source);
  if (result.success) return;

  const settings = result.error.issues.map((issue) => issue.path.join("."));
  const error = new StartupConfigError(`Invalid settings: ${settings.join(", ")}.`);
  createLogger("web", "info").error("web.startup.invalid_env", error, {
    settings,
    problems: result.error.issues.map((issue) => issue.message),
  });
  throw error;
}

// For instrumentation's register(): a throw there would leave `next start` answering every
// request with 500, so a bad configuration ends the process instead.
export function stopOnInvalidEnvironment(source: SettingsSource = process.env): void {
  try {
    validateWebEnvironment(source);
  } catch (error) {
    if (!(error instanceof StartupConfigError)) throw error;
    process.exit(1);
  }
}
