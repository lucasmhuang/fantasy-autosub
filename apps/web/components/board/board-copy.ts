import {
  espnDayChangeTime,
  espnDayLabel,
  firstName,
  formatMoment,
  formatRecentMoment,
  managerReasonSentence,
  type SubRequestStatus,
} from "@injurysub/domain";
import type { GameState, ProGame } from "@injurysub/espn";
import type { PillKind } from "@injurysub/ui";
import type { BoardWeek, OptionCounts, StartingDay } from "../../lib/server/board";

// How the league's settings route a Ready option for this team: sent at once, sent once the
// commissioner approves, or made by the commissioner (automation off, the team not on the list, or
// a playoff week).
export type ReadyRoute = "now" | "approval" | "commissioner";

// The commissioner by first name (FS-APP-9), else "the commissioner".
export function commissionerWord(name: string | null, startsSentence = false): string {
  const first = firstName(name);
  if (first !== null) return first;
  return startsSentence ? "The commissioner" : "the commissioner";
}

export function weekLabel(
  week: Pick<BoardWeek, "matchupPeriodId" | "playoffs" | "firstDate" | "lastDate">
): string {
  const number = `${week.playoffs ? "Playoffs · " : ""}Week ${week.matchupPeriodId}`;
  if (week.firstDate === null || week.lastDate === null) return number;
  return `${number} · ${espnDayLabel(week.firstDate)} – ${espnDayLabel(week.lastDate)}`;
}

const tenths = (points: number) => (Math.round(points * 10) / 10).toFixed(1);

// Today's points beside a side's total: live, or as last read while ESPN can't be reached.
export function sideToday(
  side: { livePoints: number | null },
  read: { stale: boolean; beforeFirstGame: boolean }
): string | undefined {
  if (side.livePoints === null) return read.beforeFirstGame ? "No games yet" : undefined;
  return `+${tenths(side.livePoints)} today${read.stale ? "" : ", live"}`;
}

export type HeadlineCase = {
  outCount: number;
  suspendedCount: number;
  playoffs: boolean;
  beforeFirstGame: boolean;
  // The one OUT starter already has a request this week.
  onlyStarterHasRequest: boolean;
};

// The line under the headline: what can be done, and nothing when the card says it.
export function headlineSentence(at: HeadlineCase, commissioner: string): string | null {
  if (at.outCount === 0 && at.suspendedCount === 0) {
    return "ESPN can take a few minutes to show a new OUT.";
  }
  if (at.outCount === 0) return `You can still ask; ${commissioner} decides.`;
  if (at.playoffs) {
    const playoffs = managerReasonSentence("playoffs", { commissioner, starter: "", week: 0 });
    return `${playoffs} You can still ask.`;
  }
  if (at.outCount > 1 || at.onlyStarterHasRequest) return null;
  if (at.beforeFirstGame) return "It's before his first game, so a swap forfeits nothing.";
  return null;
}

const versus = (game: ProGame) => `${game.home ? "vs" : "@"} ${game.opponent}`;
const weekday = (instant: string, zone: string) =>
  formatMoment(new Date(instant), zone, "weekday").split(" ")[0] ?? "";

function periodName(period: number): string {
  return period > 4 ? (period === 5 ? "OT" : `${period - 4}OT`) : `Q${period}`;
}

// A row's or card's game: today's from the scoreboard, its tip time when the scoreboard is unread
// or the game hasn't started (FM-BOARD-9), else the next game's weekday.
export function gameText(
  player: { todaysGame: ProGame | null; nextGame: ProGame | null; gameState: GameState | null },
  zone: string
): { text: string; live: boolean } {
  const { todaysGame: today, gameState: state } = player;
  if (today !== null) {
    if (state?.phase === "live") {
      return { text: `Live, ${periodName(state.period)} ${versus(today)}`, live: true };
    }
    if (state?.phase === "final") return { text: `Final ${versus(today)}`, live: false };
    const tip = formatMoment(new Date(today.date), zone, "time");
    return { text: `${tip} ${versus(today)}`, live: false };
  }
  if (player.nextGame !== null) {
    return { text: `next ${weekday(player.nextGame.date, zone)}`, live: false };
  }
  return { text: "No games left", live: false };
}

// The OUT card's second line: his next game, or his first before he has any points.
export function nextGameLine(next: ProGame | null, first: boolean, zone: string): string {
  if (next === null) return "No games left this week";
  const when = formatMoment(new Date(next.date), zone, "weekday");
  return `${first ? "First" : "Next"} game ${when} ${versus(next)}`;
}

export function startingDayText(day: StartingDay): string {
  const name = day.date === null ? "" : `${espnDayLabel(day.date).split(" ")[0]} `;
  return `${name}${tenths(day.points)}`;
}

export function gamesText(count: number): string {
  return `${count} ${count === 1 ? "game" : "games"}`;
}

export function points(value: number): string {
  return tenths(value);
}

// An adjustment, signed with a real minus, or a dash with none.
export function signedPoints(amountTenths: number | null): string {
  if (amountTenths === null) return "—";
  const value = (Math.abs(amountTenths) / 10).toFixed(1);
  return `${amountTenths < 0 ? "−" : "+"}${value}`;
}

export function readyGroupLabel(route: ReadyRoute, commissioner: string): string {
  if (route === "now") return "Ready now";
  if (route === "approval") return `Ready once ${commissioner} approves`;
  return `${commissioner} makes it`;
}

// Under "Choose a replacement": how many options go each way.
export function optionCountLine(
  counts: OptionCounts,
  route: ReadyRoute,
  commissioner: string
): string {
  const decides = `${commissioner} decides`;
  if (route === "commissioner") return `${counts.readyNow + counts.review} ${decides}`;
  if (counts.readyNow === 0) return `${counts.review} ${decides}`;
  const ready =
    route === "now"
      ? `${counts.readyNow} ready now`
      : `${counts.readyNow} ready once ${commissioner} approves`;
  return counts.review === 0 ? ready : `${ready}, ${counts.review} more ${decides}`;
}

export function requestPill(
  status: SubRequestStatus,
  commissioner: string
): { kind: PillKind; word: string } {
  switch (status) {
    case "queued":
      return { kind: "in-line", word: "In line" };
    case "executing":
      return { kind: "in-progress", word: "In progress" };
    case "awaiting_approval":
      return { kind: "waiting", word: `Waiting for ${commissioner}` };
    case "needs_review":
      return { kind: "waiting", word: `Waiting for ${commissioner}` };
    case "completed":
      return { kind: "done", word: "Done" };
    case "completed_manually":
      return { kind: "done", word: "Settled by hand" };
    case "rejected":
      return { kind: "stopped", word: "Rejected" };
    case "refused":
      return { kind: "stopped", word: "Refused" };
    case "withdrawn":
      return { kind: "undone", word: "Withdrawn" };
    case "reversed":
      return { kind: "undone", word: "Reversed" };
  }
}

export type NoTeamStatus =
  | "no_team"
  | "not_connected"
  | "credentials_rejected"
  | "unavailable"
  | "worker_down"
  | "database_down"
  | "season_over";

// The fallback every ESPN failure offers a manager whose starter was just ruled OUT.
function fallback(commissioner: string) {
  return `Starter ruled OUT? Text ${commissioner}; they can file it with the time you asked.`;
}

// Why there's no team to show; `retry` when trying again can help.
export function noTeamCopy(
  status: NoTeamStatus,
  name: string | null
): { title: string; sentence: string; retry: boolean } {
  const commissioner = commissionerWord(name);
  const Commissioner = commissionerWord(name, true);
  switch (status) {
    case "no_team":
      return {
        title: "No team yet",
        sentence: `Ask ${commissioner} to set your team.`,
        retry: false,
      };
    case "not_connected":
      return {
        title: "No ESPN cookie yet",
        sentence: `${Commissioner} adds it before requests open.`,
        retry: false,
      };
    case "credentials_rejected":
      return {
        title: "Can't read ESPN",
        sentence: `ESPN refused the league's cookie; ${commissioner} knows. No new requests until it's renewed; earlier ones wait. ${fallback(commissioner)}`,
        retry: false,
      };
    case "unavailable":
      return { title: "Can't reach ESPN right now", sentence: fallback(commissioner), retry: true };
    case "worker_down":
      return {
        title: "Can't load your team right now",
        sentence: `Requests in line wait. ${fallback(commissioner)}`,
        retry: true,
      };
    case "database_down":
      return {
        title: "Can't load InjurySub right now",
        sentence: `Nothing you filed is lost. ${fallback(commissioner)}`,
        retry: true,
      };
    case "season_over":
      return {
        title: "Season over",
        sentence: "",
        retry: false,
      };
  }
}

// A sentence around a freshness time, which the view keeps current (FS-TIME-8).
export type AroundTime = { before: string; time: string; after: string };

// The stale notice over the last read (FM-BOARD-1).
export function staleNotice(
  readAt: string,
  zone: string,
  name: string | null,
  now: Date
): AroundTime {
  return {
    before: "Can't reach ESPN right now. Your team below is from ",
    time: formatRecentMoment(new Date(readAt), zone, now),
    after: `. ${fallback(commissionerWord(name))}`,
  };
}

export const AFTER_LAST_GAME = "The week's last game has ended, so no more requests this week.";

// ESPN's day change in the reader's zone (PC1-4: it can still correct stats after it).
export function dayChangeNote(now: Date, zone: string): string {
  const change = espnDayChangeTime(now, zone);
  const when = change === "12:00 AM PT" ? "midnight PT" : change;
  return `ESPN's day ends at ${when}; it can still correct stats after that.`;
}

// Shared by the Team page and Choose: no bench player fits, and who can still act.
export function noOptionLines(starterSurname: string, commissioner: string): [string, string] {
  return [
    `No one on your bench fits a legal lineup with ${starterSurname} out.`,
    `${commissioner} can still settle it by hand.`,
  ];
}

// Shared by the Team page and the Requests page.
export const REQUESTS_UNREAD = "Couldn't load your requests. Try again in a moment.";
