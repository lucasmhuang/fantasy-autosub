import type { SubRequestRecord } from "@injurysub/db";
import { espnDayLabel, formatRecentMoment, slotLabel } from "@injurysub/domain";
import type { ManualSteps } from "../../lib/server/commish";
import { pacificCalendarDate } from "../../lib/server/pacific-time";
import { surname } from "../board/option-copy";

type Reading = { zone: string; now: Date };
type Request = Pick<
  SubRequestRecord,
  | "teamId"
  | "injuredPlayerId"
  | "injuredName"
  | "replacementName"
  | "requestMoment"
  | "requestDay"
  | "matchupPeriodId"
>;

export type HandStepWords = {
  title: string;
  text?: string;
  done?: boolean;
  moves?: { playerId: number; text: string; out: boolean }[];
  // A value to type on ESPN, with what it is for the Copy button.
  value?: { text: string; long?: boolean; what: string };
};

export type HandNote = { tone: "stop" | "warn"; text: string };

export type ByHandWords =
  | { kind: "none" }
  | { kind: "unreadable"; readAt: string }
  | { kind: "steps"; readAt: string; notes: HandNote[]; steps: HandStepWords[] };

const when = (instant: Date, reading: Reading) =>
  formatRecentMoment(instant, reading.zone, reading.now);
// "Glass Cannons' pairing", "Team 4's pairing".
const possessive = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`);

// A value as it's typed on ESPN: one decimal, a minus where negative, no plus.
export function enteredPoints(tenths: number): string {
  return (tenths / 10).toFixed(1).replace("-", "−");
}

function signed(tenths: number): string {
  return tenths > 0 ? `+${enteredPoints(tenths)}` : enteredPoints(tenths);
}

// The calendar date of an ESPN day, counted from the day the request was made.
export function dayLabel(request: Pick<Request, "requestMoment" | "requestDay">, day: number) {
  const asked = pacificCalendarDate(request.requestMoment);
  const shifted = new Date(
    Date.parse(`${asked}T00:00:00Z`) + (day - request.requestDay) * 86_400_000
  );
  return espnDayLabel(shifted.toISOString().slice(0, 10));
}

const DONE_STEP = (request: Request): HandStepWords => ({
  title: "Then settle it here",
  text: `Give the first day ESPN showed ${surname(request.replacementName)} active.`,
});

// What the commissioner does by hand on ESPN (FS-DETAIL-7, -8, -24, FM-DETAIL-1 to -5), from
// ESPN as the page read it.
export function byHandWords(
  { steps, request, team }: { steps: ManualSteps; request: Request; team: string },
  reading: Reading
): ByHandWords {
  if (steps.status === "not_needed") return { kind: "none" };
  if (steps.status === "unavailable" && steps.reason === "espn_unreachable") {
    return { kind: "unreadable", readAt: `Read failed ${when(steps.readAt, reading)}` };
  }
  const readAt = `From ESPN ${when(steps.readAt, reading)}`;
  if (steps.status === "unavailable") {
    return {
      kind: "steps",
      readAt,
      notes: [
        {
          tone: "stop",
          text: "ESPN is past this week, so only the adjustment can go on. To change it, set an override first.",
        },
      ],
      steps: [
        {
          title: "Adjustment on ESPN's Scoreboard",
          text: `Open Matchup ${request.matchupPeriodId}, then Adjust Scoring on ${possessive(team)} pairing, and add this request's ${signed(steps.deltaTenths)} to the adjustment already there.`,
        },
        DONE_STEP(request),
      ],
    };
  }
  return {
    kind: "steps",
    readAt,
    notes: readyNotes(steps, request),
    steps: readySteps(steps, request, team, reading),
  };
}

type Ready = Extract<ManualSteps, { status: "ready" }>;

function readyNotes(steps: Ready, request: Request): HandNote[] {
  const starter = surname(request.injuredName);
  const notes: HandNote[] = [];
  if (steps.lineupNoLongerFits !== null) {
    notes.push({
      tone: "stop",
      text: `${starter} is no longer starting on ESPN (he's at ${slotLabel(steps.lineupNoLongerFits.starterSlot)}).`,
    });
  }
  if (steps.adjustment === null && steps.heldForEarlier !== null) {
    notes.push({
      tone: "stop",
      text: `${surname(request.replacementName)} came in through an earlier request this week, so the adjustment can't be computed. Set an override first.`,
    });
  } else if (steps.adjustment === null) {
    notes.push({
      tone: "stop",
      text: `No adjustment: ${starter} hadn't played this week before the request.`,
    });
  } else if (steps.adjustment.reason === null) {
    notes.push({
      tone: "warn",
      text: "This entry would take ESPN's note past 1,000 characters. Shorten the older entries first.",
    });
  }
  return notes;
}

function readySteps(
  steps: Ready,
  request: Request,
  team: string,
  reading: Reading
): HandStepWords[] {
  const result: HandStepWords[] = [];
  const lineup = lineupStep(steps, request, team, reading);
  if (lineup !== null) result.push(lineup);
  const { adjustment } = steps;
  if (adjustment !== null) {
    const already =
      adjustment.currentTenths === 0
        ? ""
        : `: ${enteredPoints(adjustment.currentTenths)} already there, plus this request's ${signed(adjustment.deltaTenths)}`;
    result.push({
      title: "Adjustment on ESPN's Scoreboard",
      text: `Open Matchup ${adjustment.matchupPeriodId}, then Adjust Scoring on ${possessive(adjustment.teamName)} pairing. Enter ${enteredPoints(adjustment.enterTenths)}${already}.`,
      value: { text: enteredPoints(adjustment.enterTenths), what: "the adjustment" },
    });
    result.push(noteStep(adjustment.reason));
  }
  result.push(DONE_STEP(request));
  return result;
}

function lineupStep(
  steps: Ready,
  request: Request,
  team: string,
  reading: Reading
): HandStepWords | null {
  const title = `Lineup, ${team}, ${dayLabel(request, request.requestDay)}`;
  if (steps.lineupDoneAt !== null) {
    return { title, text: `Done: on ESPN ${when(steps.lineupDoneAt, reading)}.`, done: true };
  }
  if (steps.lineupMoves.length === 0) return null;
  return {
    title,
    text: "In League Manager tools, edit the lineup for that day.",
    moves: steps.lineupMoves.map((move) => ({
      playerId: move.playerId,
      text: `${surname(move.name)} ${slotLabel(move.fromSlot)} → ${slotLabel(move.toSlot)}`,
      out: move.playerId === request.injuredPlayerId,
    })),
  };
}

function noteStep(reason: string | null): HandStepWords {
  const title = "Note (the whole league sees it on ESPN)";
  if (reason === null) return { title };
  return {
    title,
    text: `Newest entry last. ${reason.length.toLocaleString("en-US")} of 1,000 characters.`,
    value: { text: reason, long: true, what: "the note" },
  };
}

// A done request's reversal (FS-DETAIL-15): the value that takes its amount back off ESPN.
export function reverseWords({
  request,
  team,
  reversal,
}: {
  request: Request;
  team: string;
  reversal: { currentTenths: number; enterTenths: number; appliedTenths: number };
}): { text: string; value: string } {
  const value = enteredPoints(reversal.enterTenths);
  return {
    text: `On ESPN's Scoreboard, open Matchup ${request.matchupPeriodId}, then Adjust Scoring on ${possessive(team)} pairing. Set their adjustment to ${value} (now ${enteredPoints(reversal.currentTenths)}). The lineup stays unless you change it on ESPN. ${surname(request.injuredName)} can't be requested again this week.`,
    value,
  };
}
