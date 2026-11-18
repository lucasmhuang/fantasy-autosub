import {
  formatMoment,
  formatRecentMoment,
  managerReasonSentence,
  type RequestEventType,
  type SubRequestStatus,
} from "@injurysub/domain";
import type { StatusTone, TrackerStep } from "@injurysub/ui";
import { renderRequestStatus } from "../../app/(app)/app/status-messages";
import type { RequestView, SentEditMove, TrackerTimes } from "../../lib/server/request-view";
import { requestPill } from "./board-copy";
import { surname } from "./option-copy";

type Found = Extract<RequestView, { status: "found" }>;
type Reading = { zone: string; now: Date; commissioner: string };

export type StatusPanelWords = { tone: StatusTone; word: string; who: string; sentence: string };

const when = (instant: Date, reading: Reading) =>
  formatRecentMoment(instant, reading.zone, reading.now);

function emailed(view: Found, reading: Reading): string {
  const email = view.alertEmail;
  if (email.state === "sent")
    return ` ${reading.commissioner} was emailed ${when(email.at, reading)}.`;
  if (email.state === "failed")
    return ` The email to ${reading.commissioner} didn't go out; text them.`;
  return "";
}

// The status panel: the state's word, who acts next only where the state doesn't say it, and one
// fact neither of the others says (copy table 1, S1).
export function requestStatusPanel(view: Found, reading: Reading): StatusPanelWords {
  const { request } = view;
  const c = reading.commissioner;
  const coming = surname(request.replacementName);
  const going = surname(request.injuredName);
  const asked = when(request.requestMoment, reading);
  switch (request.status) {
    case "queued":
      return inLine(view, reading, coming, asked);
    case "executing":
      return {
        tone: "busy",
        word: "In progress",
        who: "",
        sentence: view.delayed
          ? `ESPN stopped answering${view.tracker.lineupSentAt === null ? "" : " after the lineup change"}.`
          : "",
      };
    case "awaiting_approval":
      return {
        tone: "wait",
        word: `Waiting for ${c}`,
        who: "",
        sentence: `${coming}'s points count from ${asked} either way.${emailed(view, reading)}`,
      };
    case "needs_review": {
      const why =
        request.reviewReason === null
          ? ""
          : `${managerReasonSentence(request.reviewReason, { commissioner: c, starter: going, week: request.matchupPeriodId })} `;
      return {
        tone: "wait",
        word: `Waiting for ${c}`,
        who: "",
        sentence: `${why}${coming}'s points count from ${asked}.${emailed(view, reading)}`,
      };
    }
    default:
      return settled(view, reading, going);
  }
}

function inLine(view: Found, reading: Reading, coming: string, asked: string): StatusPanelWords {
  const c = reading.commissioner;
  if (view.notStarted) {
    return {
      tone: "neutral",
      word: "Not started",
      who: "InjurySub is down",
      sentence: `${coming}'s points count from ${asked}.`,
    };
  }
  if (view.delayed) {
    return {
      tone: "busy",
      word: "Delayed",
      who: `${c} renews the ESPN cookie`,
      sentence: `${coming}'s points count from ${asked}.`,
    };
  }
  if (view.adjustmentNotSent) {
    return {
      tone: "busy",
      word: "Lineup done",
      who: "InjurySub is down",
      sentence: "The adjustment posts when it's back.",
    };
  }
  const ahead = view.ahead;
  const sentence =
    ahead?.kind === "own"
      ? `After ${ahead.title}.`
      : ahead?.kind === "other"
        ? "After another team's request."
        : "";
  return { tone: "busy", word: "In line", who: "", sentence };
}

function settled(view: Found, reading: Reading, going: string): StatusPanelWords {
  const { request, tracker } = view;
  const c = reading.commissioner;
  const free = `${going} is free for a new request`;
  switch (request.status) {
    case "completed": {
      if (request.rehearsal) {
        return {
          tone: "neutral",
          word: "Rehearsal",
          who: "",
          sentence: "Nothing was sent to ESPN.",
        };
      }
      const on = tracker.completedAt ?? tracker.adjustmentVerifiedAt ?? tracker.lineupVerifiedAt;
      return {
        tone: "ok",
        word: "Done",
        who: on ? `On ESPN ${when(on, reading)}` : "On ESPN",
        sentence: "",
      };
    }
    case "completed_manually":
      return {
        tone: "ok",
        word: "Settled by hand",
        who: "",
        sentence: "",
      };
    case "rejected":
      return {
        tone: "neutral",
        word: "Rejected",
        who: free,
        sentence: view.commissionerReason ? `${c}: "${view.commissionerReason}"` : "",
      };
    case "withdrawn":
      return {
        tone: "neutral",
        word: "Withdrawn",
        who: free,
        sentence: "",
      };
    case "reversed":
      return {
        tone: "neutral",
        word: "Reversed",
        who: `${going} can't be requested again this week`,
        sentence: reversedSentence(view, reading),
      };
    default:
      return {
        tone: "neutral",
        word: "Refused",
        who: "",
        sentence: refusalSentence(view, c),
      };
  }
}

// The lineup change sent differs from the one confirmed: the other starter who moved, named
// against the one confirmed (FS-REQUEST-17); without names where either moved none.
export function changedLineupSentence(view: Found): string | null {
  const edit = view.sentEdit;
  if (edit === null || !edit.differsFromConfirmed) return null;
  const { injuredPlayerId, replacementPlayerId } = view.request;
  const otherMover = (moves: SentEditMove[] | null) => {
    const others = (moves ?? []).filter(
      ({ playerId }) => playerId !== injuredPlayerId && playerId !== replacementPlayerId
    );
    return others.length === 1 ? others[0] : undefined;
  };
  const sent = otherMover(edit.items);
  const confirmed = otherMover(edit.confirmed);
  const what =
    sent === undefined || confirmed === undefined
      ? "the lineup change sent differs from the one you confirmed"
      : `${surname(sent.name)} moved to ${sent.toSlot} instead of ${surname(confirmed.name)} to ${confirmed.toSlot}`;
  return `Your ESPN lineup changed while this waited, so ${what}. Your score is the same.`;
}

// "Reversed Thu 11:05 AM PT; your ESPN lineup wasn't changed back.", the time from the request's
// own record.
function reversedSentence(view: Found, reading: Reading): string {
  const reversal = view.events.findLast((event) => event.type === "reversed");
  return reversal === undefined
    ? "Your ESPN lineup wasn't changed back."
    : `Reversed ${when(reversal.at, reading)}; your ESPN lineup wasn't changed back.`;
}

// Why Confirm was refused, from what ESPN showed then (FM-CONFIRM-1 to -5); a reason without its
// detail, or one the canvas doesn't word, keeps the status message's sentence.
function refusalSentence(view: Found, commissioner: string): string {
  const { request, refusal } = view;
  const going = surname(request.injuredName);
  const coming = surname(request.replacementName);
  const plain = renderRequestStatus(request.refusalReason)?.body ?? "";
  switch (request.refusalReason) {
    case "not_out": {
      const shown = designationWord(refusal?.designation ?? null);
      return shown === null
        ? plain
        : `${plain} When you confirmed, ESPN showed ${going} as ${shown}.`;
    }
    case "injured_not_starting":
      return `${going} is no longer in your starting lineup on ESPN.`;
    case "replacement_not_on_bench": {
      const slot = refusal?.replacementSlot ?? null;
      const shows = slot === null ? "" : ` (ESPN shows him at ${slot})`;
      return `${coming} is no longer on your bench${shows}. Pick another replacement.`;
    }
    case "active_request_exists": {
      const other = refusal?.activeRequest ?? null;
      if (other === null) return `${going} already has a request this week.`;
      const word = requestPill(other.status, commissioner).word;
      const status = word.charAt(0).toLowerCase() + word.slice(1);
      return `${going} already has a request this week: ${other.title}, ${status}.`;
    }
    case "week_over":
      return `Week ${request.matchupPeriodId} ended before you confirmed.`;
    default:
      return plain;
  }
}

// ESPN's designation as a manager reads it; null when it sent none.
function designationWord(designation: string | null): string | null {
  if (designation === null || designation === "none") return null;
  if (designation === "SUSPENSION") return "suspended";
  return designation.toLowerCase().replaceAll("_", "-");
}

const time = (instant: Date, zone: string) => formatMoment(instant, zone, "time");

// The four steps of a run, each done with its time, the one under way active, the rest to do.
export function trackerSteps(
  status: SubRequestStatus,
  times: TrackerTimes,
  at: { owed: boolean; zone: string }
): TrackerStep[] {
  const done = status === "completed" || times.completedAt !== null;
  const step = (label: string, finished: Date | null, started: Date | null): TrackerStep => {
    if (finished !== null) return { label, state: "done", note: time(finished, at.zone) };
    if (started !== null) return { label, state: "active", note: `sent ${time(started, at.zone)}` };
    return { label, state: "todo", note: "—" };
  };
  const adjustment: TrackerStep =
    !at.owed && done
      ? { label: "Adjustment", state: "skip", note: "not owed" }
      : step("Adjustment", times.adjustmentVerifiedAt, times.adjustmentSentAt);
  return [
    step("Checked", times.checkedAt, null),
    step("Lineup", times.lineupVerifiedAt, times.lineupSentAt),
    adjustment,
    step("Done", times.completedAt, null),
  ];
}

// Each event in the request's record, as the manager reads it.
export function recordText(
  type: RequestEventType,
  title: string,
  commissioner: string,
  // A reversal's signed amount (FS-REQUEST-15); an approval the commissioner gave their own team
  // (IF-DETAIL-4).
  extra: { reversal?: string; selfApproval?: boolean } = {}
): string {
  const { reversal, selfApproval = false } = extra;
  const texts: Record<RequestEventType, string> = {
    request_filed: `Asked: ${title}`,
    request_refused: "Refused",
    approved: `${commissioner} approved${selfApproval ? " (self-approval)" : ""}`,
    reapproved: `${commissioner} approved the new amount`,
    rejected: `${commissioner} rejected it`,
    withdrawn: "Withdrawn",
    override_set: `${commissioner} set the amount`,
    completed_manually: `${commissioner} settled it by hand`,
    reversed: `${commissioner} reversed it${reversal === undefined ? "" : `: ${reversal}`}`,
    expired: "Waited too long; sent to the commissioner",
    week_ended: "The week ended before it ran",
    claimed: "Started",
    preflight_passed: "Checked ESPN",
    sent_to_review: `Sent to ${commissioner}`,
    lineup_sent: "Lineup change sent",
    lineup_verified: "Lineup changed on ESPN",
    adjustment_held: `Adjustment held for ${commissioner}`,
    adjustment_sent: "Adjustment sent",
    adjustment_verified: "Adjustment posted on ESPN",
    completed: "Done",
    requeued: "Back in line",
    proving_side_read: "Checked ESPN",
    pass_failed: "A try didn't finish; trying again",
  };
  return texts[type];
}
