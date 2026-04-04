import { z } from "zod";

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().default(
    "postgres://postgres:postgres@localhost:5432/injurysub"
  ),
  APP_BASE_URL: z.string().default("http://localhost:3000"),
  EMAIL_FROM_ADDRESS: z.string().default("noreply@example.com"),
  RESEND_API_KEY: z.string().optional(),
  ESPN_S2: z.string().optional(),
  ESPN_SWID: z.string().optional(),
  LEAGUE_ID: z.string().optional(),
  SEASON_YEAR: z.string().default("2026")
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function loadServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  return serverEnvSchema.parse(source);
}

export { serverEnvSchema };

