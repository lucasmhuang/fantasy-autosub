import { z } from "zod";

// The worker's internal read API, shared by the worker (which serves it) and the web (which calls
// it), so the two sides can't drift. Only reads: the API has no write path.
export const INTERNAL_READS = {
  getTeamWeek: {
    path: "/internal/espn/team-week",
    args: z.object({ teamId: z.number().int().positive() }),
  },
} as const;
export type InternalReadName = keyof typeof INTERNAL_READS;

// Every answer: the read's result, or the EspnError code it failed with (or a fixed code).
export const internalReadAnswerSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), result: z.unknown() }),
  z.object({ ok: z.literal(false), code: z.string() }),
]);
export type InternalReadAnswer = z.infer<typeof internalReadAnswerSchema>;
