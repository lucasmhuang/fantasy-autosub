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
const HOSTED_SESSION_SECRET_MIN_LENGTH = 32;
// localhost, *.localhost, 127.0.0.0/8, ::1 and 0.0.0.0 all mean this machine.
const LOCAL_HOSTNAME = /^(localhost|.+\.localhost|127(\.\d{1,3}){3}|\[::1\]|0\.0\.0\.0)$/;

export const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    LOG_LEVEL: logLevelSchema.default("info"),
    // Hosted unless this says otherwise: production is hosted, and a local `next start`, which sets
    // NODE_ENV=production itself, opts out with DEPLOYMENT_MODE=local.
    DEPLOYMENT_MODE: blankAsUndefined(z.enum(["hosted", "local"]).optional()),
    DATABASE_URL: z.string().min(1).default(DEFAULT_DATABASE_URL),
    APP_BASE_URL: z.string().url().default("http://localhost:3000"),
    SESSION_COOKIE_NAME: z.string().min(1).default("injurysub_session"),
    SESSION_SECRET: z.string().min(16).default(DEV_SESSION_SECRET),
    MAGIC_LINK_TTL_MINUTES: positiveInteger.default(15),
    SIGN_IN_CODE_TTL_MINUTES: positiveInteger.default(10),
    // Days since the session was last used.
    SESSION_TTL_DAYS: positiveInteger.default(90),
    EMAIL_DELIVERY_MODE: z.enum(["console", "resend"]).default("console"),
    EMAIL_FROM_ADDRESS: z.string().email().default(DEFAULT_EMAIL_FROM_ADDRESS),
    RESEND_API_KEY: blankAsUndefined(z.string().optional()),
    ESPN_MODE: z.enum(["stub", "live"]).default("stub"),
    ESPN_S2: blankAsUndefined(z.string().optional()),
    ESPN_SWID: blankAsUndefined(z.string().optional()),
    LEAGUE_ID: blankAsUndefined(positiveInteger.optional()),
    SEASON_YEAR: z.coerce.number().int().min(2020).max(2100).default(2027),
    WORKER_HEALTH_PORT: positiveInteger.default(3001),
    WORKER_SWEEP_INTERVAL_MS: positiveInteger.default(15_000),
  })
  .superRefine((env, context) => {
    if (resolveDeploymentMode(env) === "hosted") {
      for (const { path, message } of findHostedSettingProblems(env)) {
        context.addIssue({ code: "custom", message, path: [path] });
      }
    }

    if (env.EMAIL_DELIVERY_MODE === "resend" && !env.RESEND_API_KEY) {
      context.addIssue({
        code: "custom",
        message: "RESEND_API_KEY is required when EMAIL_DELIVERY_MODE is resend.",
        path: ["RESEND_API_KEY"],
      });
    }

    if (env.ESPN_MODE === "live") {
      if (!env.ESPN_S2) {
        context.addIssue({
          code: "custom",
          message: "ESPN_S2 is required when ESPN_MODE is live.",
          path: ["ESPN_S2"],
        });
      }

      if (!env.ESPN_SWID) {
        context.addIssue({
          code: "custom",
          message: "ESPN_SWID is required when ESPN_MODE is live.",
          path: ["ESPN_SWID"],
        });
      }

      if (!env.LEAGUE_ID) {
        context.addIssue({
          code: "custom",
          message: "LEAGUE_ID is required when ESPN_MODE is live.",
          path: ["LEAGUE_ID"],
        });
      }
    }
  });

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
  "APP_BASE_URL" | "SESSION_SECRET" | "EMAIL_DELIVERY_MODE" | "EMAIL_FROM_ADDRESS" | "DATABASE_URL"
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
  if (
    env.SESSION_SECRET === DEV_SESSION_SECRET ||
    env.SESSION_SECRET.length < HOSTED_SESSION_SECRET_MIN_LENGTH
  ) {
    problems.push({
      path: "SESSION_SECRET",
      message: `SESSION_SECRET must be a random value of at least ${HOSTED_SESSION_SECRET_MIN_LENGTH} characters.`,
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
  if (env.DATABASE_URL === DEFAULT_DATABASE_URL) {
    problems.push({ path: "DATABASE_URL", message: "DATABASE_URL must name the hosted database." });
  }
  return problems;
}

function isPublicHttpsUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === "https:" && !LOCAL_HOSTNAME.test(url.hostname);
}
export type LogLevel = z.infer<typeof logLevelSchema>;

export function loadServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  return serverEnvSchema.parse(source);
}
