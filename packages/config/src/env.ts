import { z } from "zod";

const positiveInteger = z.coerce.number().int().positive();

// A blank optional setting (e.g. `LEAGUE_ID=` in .env.example) means "not set", not "".
function blankAsUndefined<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === "" ? undefined : value), schema);
}

export const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);

const DEFAULT_DATABASE_URL = "postgres://postgres:postgres@localhost:5432/injurysub";
const DEV_SESSION_SECRET = "dev-session-secret-change-me";
const DEFAULT_EMAIL_FROM_ADDRESS = "noreply@example.com";
const DEV_WORKER_INTERNAL_TOKEN = "dev-worker-internal-token-change-me";
const HOSTED_SECRET_MIN_LENGTH = 32;
// localhost, *.localhost, 127.0.0.0/8, ::1 and 0.0.0.0 all mean this machine.
const LOCAL_HOSTNAME = /^(localhost|.+\.localhost|127(\.\d{1,3}){3}|\[::1\]|0\.0\.0\.0)$/;

const serverEnvObject = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: logLevelSchema.default("info"),
  // Hosted unless this says otherwise: production is hosted, and a local `next start`, which sets
  // NODE_ENV=production itself, opts out with DEPLOYMENT_MODE=local.
  DEPLOYMENT_MODE: blankAsUndefined(z.enum(["hosted", "local"]).optional()),
  DATABASE_URL: z.string().min(1).default(DEFAULT_DATABASE_URL),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  SESSION_COOKIE_NAME: z.string().min(1).default("injurysub_session"),
  SESSION_SECRET: z.string().min(16).default(DEV_SESSION_SECRET),
  SIGN_IN_CODE_TTL_MINUTES: positiveInteger.default(10),
  // Days since the session was last used.
  SESSION_TTL_DAYS: positiveInteger.default(90),
  EMAIL_DELIVERY_MODE: z.enum(["console", "resend"]).default("console"),
  EMAIL_FROM_ADDRESS: z.string().email().default(DEFAULT_EMAIL_FROM_ADDRESS),
  RESEND_API_KEY: blankAsUndefined(z.string().optional()),
  // stub reads the committed recordings, scripted a named scenario over them, and none refuses
  // every ESPN call (a deployment without the cookie).
  ESPN_MODE: z.enum(["stub", "live", "scripted", "none"]).default("stub"),
  ESPN_SCENARIO: blankAsUndefined(z.string().optional()),
  ESPN_S2: blankAsUndefined(z.string().optional()),
  ESPN_SWID: blankAsUndefined(z.string().optional()),
  LEAGUE_ID: blankAsUndefined(positiveInteger.optional()),
  SEASON_YEAR: z.coerce.number().int().min(2020).max(2100).default(2027),
  WORKER_HEALTH_PORT: positiveInteger.default(3001),
  WORKER_SWEEP_INTERVAL_MS: positiveInteger.default(15_000),
  // Where the web reaches the worker's internal read API, and the bearer token both sides share.
  WORKER_INTERNAL_URL: z.string().url().default("http://127.0.0.1:3001"),
  WORKER_INTERNAL_TOKEN: z.string().min(1).default(DEV_WORKER_INTERNAL_TOKEN),
  // How long a request waits for approval or execution before it goes to review.
  REQUEST_EXPIRY_HOURS: positiveInteger.default(12),
});

type ServerEnvInput = z.infer<typeof serverEnvObject>;

export const serverEnvSchema = serverEnvObject.superRefine((env, context) => {
  for (const { path, message } of findSettingProblems(env)) {
    context.addIssue({ code: "custom", message, path: [path] });
  }
});

type SettingProblem = { path: string; message: string };

function findSettingProblems(env: ServerEnvInput): SettingProblem[] {
  return [
    ...(resolveDeploymentMode(env) === "hosted" ? findHostedSettingProblems(env) : []),
    ...findEmailProblems(env),
    ...findEspnProblems(env),
  ];
}

function findEmailProblems(env: Pick<ServerEnvInput, "EMAIL_DELIVERY_MODE" | "RESEND_API_KEY">) {
  return env.EMAIL_DELIVERY_MODE === "resend" && !env.RESEND_API_KEY
    ? [
        {
          path: "RESEND_API_KEY",
          message: "RESEND_API_KEY is required when EMAIL_DELIVERY_MODE is resend.",
        },
      ]
    : [];
}

function findEspnProblems(
  env: Pick<ServerEnvInput, "ESPN_MODE" | "ESPN_SCENARIO" | "ESPN_S2" | "ESPN_SWID" | "LEAGUE_ID">
): SettingProblem[] {
  if (env.ESPN_MODE === "scripted" && !env.ESPN_SCENARIO) {
    return [
      { path: "ESPN_SCENARIO", message: "ESPN_SCENARIO is required when ESPN_MODE is scripted." },
    ];
  }
  if (env.ESPN_MODE !== "live") return [];
  const required = [
    ["ESPN_S2", env.ESPN_S2],
    ["ESPN_SWID", env.ESPN_SWID],
    ["LEAGUE_ID", env.LEAGUE_ID],
  ] as const;
  return required
    .filter(([, value]) => !value)
    .map(([path]) => ({ path, message: `${path} is required when ESPN_MODE is live.` }));
}

export type ServerEnv = z.infer<typeof serverEnvSchema>;

type DeploymentSettings = {
  NODE_ENV: "development" | "test" | "production";
  DEPLOYMENT_MODE?: "hosted" | "local" | undefined;
};

function resolveDeploymentMode(env: DeploymentSettings): "hosted" | "local" {
  return env.DEPLOYMENT_MODE ?? (env.NODE_ENV === "production" ? "hosted" : "local");
}

type HostedSettings = Pick<
  ServerEnv,
  | "APP_BASE_URL"
  | "SESSION_SECRET"
  | "EMAIL_DELIVERY_MODE"
  | "EMAIL_FROM_ADDRESS"
  | "DATABASE_URL"
  | "WORKER_INTERNAL_TOKEN"
>;

// A hosted deployment must not run on development defaults. Each problem names its setting and
// never its value, since the value may be a secret.
function findHostedSettingProblems(env: HostedSettings): { path: string; message: string }[] {
  const problems: { path: string; message: string }[] = [];
  if (!isPublicHttpsUrl(env.APP_BASE_URL)) {
    problems.push({
      path: "APP_BASE_URL",
      message: "APP_BASE_URL must be the app's public https address.",
    });
  }
  if (!isHostedSecret(env.SESSION_SECRET, DEV_SESSION_SECRET)) {
    problems.push({
      path: "SESSION_SECRET",
      message: `SESSION_SECRET must be a random value of at least ${HOSTED_SECRET_MIN_LENGTH} characters.`,
    });
  }
  if (env.EMAIL_DELIVERY_MODE !== "resend") {
    problems.push({ path: "EMAIL_DELIVERY_MODE", message: "EMAIL_DELIVERY_MODE must be resend." });
  }
  if (env.EMAIL_FROM_ADDRESS === DEFAULT_EMAIL_FROM_ADDRESS) {
    problems.push({
      path: "EMAIL_FROM_ADDRESS",
      message: "EMAIL_FROM_ADDRESS must be the verified sending address.",
    });
  }
  if (!isRemoteUrl(env.DATABASE_URL)) {
    problems.push({ path: "DATABASE_URL", message: "DATABASE_URL must name the hosted database." });
  }
  if (!isHostedSecret(env.WORKER_INTERNAL_TOKEN, DEV_WORKER_INTERNAL_TOKEN)) {
    problems.push({
      path: "WORKER_INTERNAL_TOKEN",
      message: `WORKER_INTERNAL_TOKEN must be a random value of at least ${HOSTED_SECRET_MIN_LENGTH} characters.`,
    });
  }
  return problems;
}

function isHostedSecret(value: string, devDefault: string): boolean {
  return value !== devDefault && value.length >= HOSTED_SECRET_MIN_LENGTH;
}

function isPublicHttpsUrl(value: string): boolean {
  return isRemoteUrl(value) && new URL(value).protocol === "https:";
}

// A URL whose host isn't this machine. A trailing dot names the same host ("localhost.").
function isRemoteUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const hostname = new URL(value).hostname.replace(/\.$/, "");
  return hostname !== "" && !LOCAL_HOSTNAME.test(hostname);
}
export type LogLevel = z.infer<typeof logLevelSchema>;

export function loadServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  return serverEnvSchema.parse(source);
}
