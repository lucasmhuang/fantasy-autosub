import { z } from "zod";
import { EspnError } from "./errors";

// ESPN's game root names the season in progress. Its `active` flags can't: last season's root
// and league also report active (probe, 2026-10-23).
const gameRootSchema = z.object({ currentSeasonId: z.number().int() });

export type RequestGameRoot = (signal: AbortSignal) => Promise<unknown>;

export type CheckSeason = (signal: AbortSignal) => Promise<void>;

async function readCurrentSeason(requestGameRoot: RequestGameRoot, signal: AbortSignal) {
  const parsed = gameRootSchema.safeParse(await requestGameRoot(signal));
  if (parsed.success) return parsed.data.currentSeasonId;
  const issue = parsed.error.issues[0];
  const field = issue?.path.join(".") || "the response";
  throw new EspnError(
    "unrecognized_response",
    `ESPN's game root has no readable currentSeasonId (${field}: ${issue?.message ?? "invalid"})`,
    { cause: parsed.error }
  );
}

// How long an answer is kept: a worker runs for months, and ESPN moves to the next season in the
// autumn, so its reads stop within a day of that.
const SEASON_ANSWER_TTL_MS = 24 * 60 * 60 * 1000;

// Refuses reads for a configured season other than the one in progress. Only a successful
// answer is kept, for a day, so a failed check is retried on the next read and a long-running
// client recovers without a restart. Concurrent checks that need an answer share one request.
export function createSeasonCheck(
  configuredSeason: number,
  requestGameRoot: RequestGameRoot,
  now: () => number = Date.now
): CheckSeason {
  let answer: { season: number; readAt: number } | undefined;
  let pending: Promise<number> | undefined;

  return async (signal) => {
    if (answer === undefined || now() - answer.readAt >= SEASON_ANSWER_TTL_MS) {
      pending ??= readCurrentSeason(requestGameRoot, signal).finally(() => {
        pending = undefined;
      });
      answer = { season: await pending, readAt: now() };
    }
    const seasonInProgress = answer.season;
    if (seasonInProgress !== configuredSeason) {
      throw new EspnError(
        "season_not_in_progress",
        `configured season ${configuredSeason} is not the season in progress (${seasonInProgress})`
      );
    }
  };
}
