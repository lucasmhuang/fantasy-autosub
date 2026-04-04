import { z } from "zod";

const positiveInteger = z.coerce.number().int().positive();

export const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);

export const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    LOG_LEVEL: logLevelSchema.default("info"),
    DATABASE_URL: z
      .string()
      .min(1)
      .default("postgres://postgres:postgres@localhost:5432/injurysub"),
    APP_BASE_URL: z.string().url().default("http://localhost:3000"),
    SESSION_COOKIE_NAME: z.string().min(1).default("injurysub_session"),
    SESSION_SECRET: z.string().min(16).default("dev-session-secret-change-me"),
    MAGIC_LINK_TTL_MINUTES: positiveInteger.default(15),
    SESSION_TTL_DAYS: positiveInteger.default(90),
    EMAIL_DELIVERY_MODE: z.enum(["console", "resend"]).default("console"),
    EMAIL_FROM_ADDRESS: z.string().email().default("noreply@example.com"),
    RESEND_API_KEY: z.string().optional(),
    ESPN_MODE: z.enum(["stub", "live"]).default("stub"),
    ESPN_S2: z.string().optional(),
    ESPN_SWID: z.string().optional(),
    LEAGUE_ID: positiveInteger.optional(),
    SEASON_YEAR: z.coerce.number().int().min(2020).max(2100).default(2026),
    WORKER_HEALTH_PORT: positiveInteger.default(3001),
    WORKER_SWEEP_INTERVAL_MS: positiveInteger.default(15_000),
  })
  .superRefine((env, context) => {
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
export type LogLevel = z.infer<typeof logLevelSchema>;

export function loadServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  return serverEnvSchema.parse(source);
}
