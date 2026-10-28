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

// Refuses reads for a configured season other than the one in progress. Only a successful
// answer is kept, so a failed check is retried on the next read and a long-running client
// recovers without a restart. Concurrent first checks share one request.
export function createSeasonCheck(
  configuredSeason: number,
  requestGameRoot: RequestGameRoot
): CheckSeason {
  let seasonInProgress: number | undefined;
  let pending: Promise<number> | undefined;

  return async (signal) => {
    if (seasonInProgress === undefined) {
      pending ??= readCurrentSeason(requestGameRoot, signal).finally(() => {
        pending = undefined;
      });
      seasonInProgress = await pending;
    }
    if (seasonInProgress !== configuredSeason) {
      throw new EspnError(
        "season_not_in_progress",
        `configured season ${configuredSeason} is not the season in progress (${seasonInProgress})`
      );
    }
  };
}
