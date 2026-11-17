import {
  formatMoment,
  formatRecentMoment,
  type RequestEventType,
  type ReviewReason,
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

// The manager's words for why a request waits on the commissioner.
export function reviewReasonWords(
  reason: ReviewReason,
  commissioner: string,
  starter: string
): string {
  switch (reason) {
    case "automation_off":
      return `${commissioner} is making swaps by hand for now.`;
    case "not_allowlisted":
      return `${commissioner} handles your team's swaps by hand for now.`;
    case "rearrangement":
      return `Two other starters would have to move, so ${commissioner} makes this swap by hand.`;
    case "suspension":
      return `${starter} is suspended, not OUT, so ${commissioner} decides.`;
    case "stale":
      return `Your ESPN lineup changed after you asked, so nothing was sent. ${commissioner} will look at it.`;
    case "ambiguous":
      return `ESPN's lineup didn't match after the change; ${commissioner} is checking it. No adjustment was posted.`;
    case "lineup_failed":
      return `ESPN didn't accept the lineup change, so nothing changed. ${commissioner} will make it by hand.`;
    case "adjustment_failed":
      return `Your lineup is done on ESPN. The adjustment didn't go through, so ${commissioner} will post it.`;
    case "adjustment_held_rules":
      return `Your lineup is done on ESPN. ${commissioner} posts the adjustment: the league's ESPN settings differ from InjurySub's.`;
    case "adjustment_changed":
      return `Your lineup is done. The adjustment changed after ${commissioner} approved it, so they approve the new amount.`;
    case "expired":
      return `It waited 12 hours without running, so it's with ${commissioner} now.`;
    case "week_ended":
      return `The week ended before it ran, so ${commissioner} settles it.`;
    case "playoffs":
      return `In playoff weeks ${commissioner} settles every swap.`;
  }
}

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

// The status panel: the state's word, who acts next, and one sentence.
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
        who: "InjurySub acts next",
        sentence: view.delayed
          ? `ESPN stopped answering${view.tracker.lineupSentAt === null ? "" : " after the lineup change"}. InjurySub keeps checking and finishes from what ESPN shows.`
          : "Usually under a minute. You can close this.",
      };
    case "awaiting_approval":
      return {
        tone: "wait",
        word: "Waiting for approval",
        who: `${c} decides`,
        sentence: `Nothing changes on ESPN until they approve. ${coming}'s points count from ${asked} either way.${emailed(view, reading)}`,
      };
    case "needs_review": {
      const why =
        request.reviewReason === null
          ? ""
          : `${reviewReasonWords(request.reviewReason, c, going)} `;
      return {
        tone: "wait",
        word: `Waiting for ${c}`,
        who: `${c} decides`,
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
      who: "InjurySub, when it's back",
      sentence: "InjurySub is down, so nothing has been sent. It runs when InjurySub is back.",
    };
  }
  if (view.delayed) {
    return {
      tone: "busy",
      word: "Delayed",
      who: `${c} fixes ESPN access`,
      sentence: `Nothing has been sent yet. It runs once access is back; ${coming}'s points count from ${asked}.`,
    };
  }
  if (view.adjustmentNotSent) {
    return {
      tone: "busy",
      word: "In progress",
      who: "InjurySub, when it's back",
      sentence:
        "Your lineup is done on ESPN. InjurySub is down, so the adjustment waits until it's back.",
    };
  }
  const ahead = view.ahead;
  const sentence =
    ahead?.kind === "own"
      ? `Runs after ${ahead.title} finishes, usually within a minute.`
      : ahead?.kind === "other"
        ? "Another team's swap goes first. Usually under a minute."
        : "Usually under a minute.";
  return { tone: "busy", word: "In line", who: "InjurySub acts next", sentence };
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
          who: "Nothing was sent to ESPN",
          sentence: "These are the changes it would have made.",
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
        word: `Done by ${c}`,
        who: "Settled by hand",
        sentence: `${c} settled it by hand.`,
      };
    case "rejected":
      return {
        tone: "neutral",
        word: "Rejected",
        who: free,
        sentence: view.commissionerReason
          ? `${c} declined it: "${view.commissionerReason}"`
          : `${c} declined it.`,
      };
    case "withdrawn":
      return {
        tone: "neutral",
        word: "Withdrawn",
        who: free,
        sentence: "Nothing was sent to ESPN.",
      };
    case "reversed":
      return {
        tone: "neutral",
        word: "Reversed",
        who: `${going} can't be requested again this week`,
        sentence: `${reversedAt(view, reading)}Your ESPN lineup wasn't changed back.`,
      };
    default:
      return {
        tone: "neutral",
        word: "Refused",
        who: "Nothing happened on ESPN",
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

// "Reversed Thu 11:05 AM PT. ", from the request's own record.
function reversedAt(view: Found, reading: Reading): string {
  const reversal = view.events.findLast((event) => event.type === "reversed");
  return reversal === undefined ? "" : `Reversed ${when(reversal.at, reading)}. `;
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
