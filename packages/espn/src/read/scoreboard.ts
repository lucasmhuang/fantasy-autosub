import { z } from "zod";
import type { GameState } from "./contracts";
import { EspnError } from "./errors";

// ESPN's public NBA scoreboard for one day: each game's tip, state, period and clock, and its two
// teams. A team's id there is its pro team id in the fantasy schedule (all 30 checked, 2026-11-16).
export const scoreboardResponseSchema = z.object({
  events: z.array(
    z.object({
      // Minute precision ("2026-11-15T18:00Z").
      date: z.iso.datetime(),
      status: z.object({
        period: z.number().int().nonnegative(),
        displayClock: z.string(),
        type: z.object({
          state: z.string(),
          name: z.string(),
          completed: z.boolean(),
          shortDetail: z.string(),
        }),
      }),
      competitions: z
        .array(
          z.object({
            competitors: z.array(
              z.object({
                homeAway: z.string(),
                team: z.object({ id: z.string(), abbreviation: z.string() }),
              })
            ),
          })
        )
        .min(1),
    })
  ),
});

export type ScoreboardResponse = z.infer<typeof scoreboardResponseSchema>;
type ScoreboardEvent = ScoreboardResponse["events"][number];

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// A calendar date (YYYY-MM-DD) as the scoreboard's dates parameter (YYYYMMDD).
export function scoreboardDayOf(date: string): string {
  const match = CALENDAR_DATE.exec(date);
  const asDate = new Date(`${date}T00:00:00Z`);
  if (!match || Number.isNaN(asDate.getTime()) || asDate.toISOString().slice(0, 10) !== date) {
    throw new RangeError(`${JSON.stringify(date)} isn't a calendar date (YYYY-MM-DD)`);
  }
  return `${match[1]}${match[2]}${match[3]}`;
}

// Live only while ESPN has the game on its clock ("in": halftime and a period's end included),
// final only when ESPN calls it completed, scheduled only while ESPN does.
function phaseOf(type: ScoreboardEvent["status"]["type"]): GameState["phase"] {
  if (type.state === "in") return "live";
  if (type.state === "post" && type.completed) return "final";
  if (type.state === "pre" && type.name === "STATUS_SCHEDULED") return "scheduled";
  return "other";
}

function teamIdOf(event: ScoreboardEvent, side: "home" | "away", readName: string): number {
  const competitors = event.competitions[0]?.competitors ?? [];
  const onSide = competitors.filter((competitor) => competitor.homeAway === side);
  const id = Number(onSide[0]?.team.id);
  if (competitors.length !== 2 || onSide.length !== 1 || !Number.isInteger(id) || id <= 0) {
    throw new EspnError(
      "unrecognized_response",
      `ESPN's scoreboard lists a game at ${event.date} without one ${side} team it can name (reading ${readName})`
    );
  }
  return id;
}

export function gameStatesOf(body: ScoreboardResponse, readName: string): GameState[] {
  return body.events.map((event) => ({
    homeProTeamId: teamIdOf(event, "home", readName),
    awayProTeamId: teamIdOf(event, "away", readName),
    tip: new Date(event.date).toISOString(),
    phase: phaseOf(event.status.type),
    period: event.status.period,
    clock: event.status.displayClock,
  }));
}
