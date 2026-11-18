import {
  calendarDateIn,
  formatMoment,
  formatRecentMoment,
  type MisuseAlertKind,
  misuseAlertTitle,
  slotLabel,
} from "@injurysub/domain";
import type { TeamMove, WatchState } from "../../lib/server/commish-alerts";
import { surname } from "../board/option-copy";

type Reading = { zone: string; now: Date };

// A time on this page, in the reader's zone: the weekday within six days, else the date.
export function when(instant: Date, reading: Reading): string {
  return formatRecentMoment(instant, reading.zone, reading.now);
}

// An alert's title by its kind (Revision 5, B), shared with the queue and the email.
export function alertTitle(kind: MisuseAlertKind, team: string | null): string {
  return misuseAlertTitle(kind, team);
}

// ESPN's time and when InjurySub saw it, or only the latter (Revision 5, I).
// The seen time drops its day when it's ESPN's time's day, as the canvas draws it.
export function alertTimeLine(espnAt: Date | null, foundAt: Date, reading: Reading): string {
  if (espnAt === null) return `Seen ${when(foundAt, reading)}`;
  const sameDay = calendarDateIn(espnAt, reading.zone) === calendarDateIn(foundAt, reading.zone);
  const seen = sameDay ? formatMoment(foundAt, reading.zone, "time") : when(foundAt, reading);
  return `ESPN's time ${when(espnAt, reading)} · seen ${seen}`;
}

const PAUSED_WHY: Record<Extract<WatchState, { state: "paused" }>["reason"], string> = {
  credentials_rejected: "ESPN refused the cookie",
  unreachable: "ESPN couldn't be reached",
  not_connected: "No ESPN cookie yet",
};

// The watch's state under the title, and while it's paused or not started, why (FS-ALERTS-1,
// FM-ALERTS-1, Revision 5, E).
export function watchLine(
  watch: WatchState,
  reading: Reading
): { sub: string; notice: string | null } {
  if (watch.state === "watching") {
    return { sub: `Watching ESPN · checked ${when(watch.checkedAt, reading)}`, notice: null };
  }
  if (watch.state === "not_started") {
    return { sub: "Not started", notice: "It starts once the worker has the ESPN cookie." };
  }
  return {
    sub: `Paused since ${when(watch.since, reading)}`,
    notice: `Detection is paused: ${PAUSED_WHY[watch.reason]}, so nothing is being checked. You were emailed. Silence here doesn't mean nothing happened.`,
  };
}

function typeWord(type: string): string {
  const lower = type.toLowerCase().replaceAll("_", " ");
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

// One move on the commissioner's team (FS-ALERTS-5): a lineup move by surname and slots, or each
// item by its type and the player's name.
export function moveLine(move: TeamMove): string {
  const lineup = move.items.every((item) => item.fromSlot !== null && item.toSlot !== null);
  if (lineup && move.items.length > 0) {
    const by = move.byLeagueManager ? " by the league manager" : "";
    const moves = move.items.map(
      (item) =>
        `${surname(item.player)} ${slotLabel(item.fromSlot ?? "")} → ${slotLabel(item.toSlot ?? "")}`
    );
    return `Lineup${by}: ${moves.join(", ")}`;
  }
  return move.items.map((item) => `${typeWord(item.type)}: ${item.player}`).join(" · ");
}
