import type { AlertEmailState } from "@injurysub/db";
import {
  formatRecentMoment,
  isRequestEventType,
  type RequestEventType,
  type ReviewReason,
  requestAmountTenths,
} from "@injurysub/domain";
import type { StatusTone } from "@injurysub/ui";
import type { RequestDetailView } from "../../lib/server/commish";
import { selfApprovalOf } from "../../lib/server/request-view";
import { commissionerWord, signedPoints } from "../board/board-copy";
import { surname } from "../board/option-copy";
import { recordText } from "../board/request-copy";
import { REASON_PILLS, reasonSentence } from "./queue-copy";

type Found = Extract<RequestDetailView, { status: "found" }>;
// ownTeam: the request is for the commissioner's own team.
type Reading = { zone: string; now: Date; ownTeam: boolean };

const when = (instant: Date, reading: Reading) =>
  formatRecentMoment(instant, reading.zone, reading.now);
const teamOf = (view: Found) => view.names.team ?? `Team ${view.request.teamId}`;
const managerOf = (view: Found) => commissionerWord(view.names.manager, true);
const lastEventAt = (view: Found, type: string) =>
  view.events.findLast((event) => event.eventType === type)?.createdAt ?? null;

// The header (FS-DETAIL-1): team, the swap in full with its slot, and who asked when.
export function detailHeader(view: Found, reading: Reading) {
  const { request, names } = view;
  const manager = names.manager === null ? null : commissionerWord(names.manager);
  const asked = `Asked ${when(request.requestMoment, reading)}`;
  return {
    team: teamOf(view),
    swap: `${request.replacementName} in for ${request.injuredName} · ${request.injuredSlot} slot`,
    asked:
      request.kind === "on_behalf"
        ? `Filed by you${manager === null ? "" : ` for ${manager}`}`
        : reading.ownTeam
          ? `${asked} · you`
          : manager === null
            ? asked
            : `${asked} · ${manager}`,
  };
}

export type DetailStatusWords = { tone: StatusTone; word: string; who: string; sentence: string };

// One status line that carries the explanation (FS-DETAIL-2, -21, -22).
export function detailStatus(view: Found, reading: Reading): DetailStatusWords {
  const { request } = view;
  switch (request.status) {
    case "awaiting_approval":
      return {
        tone: "wait",
        word: "Needs you: approval",
        who: "",
        sentence: approvalSentence(view, reading),
      };
    case "needs_review":
      return reviewStatus(view, reading);
    case "queued":
      return queuedStatus(view, reading);
    case "executing":
      return {
        tone: "busy",
        word: "In progress",
        who: "InjurySub acts next",
        sentence: "Actions come back if it stops.",
      };
    default:
      return settledStatus(view, reading);
  }
}

function approvalSentence(view: Found, reading: Reading): string {
  const { request } = view;
  if (reading.ownTeam) {
    return "Your own team's request. Approving it shows as a self-approval in its record and your team's history.";
  }
  if (request.kind === "on_behalf" && request.expiresAt !== null) {
    return `Expires ${when(request.expiresAt, reading)}, 12 hours after you filed.`;
  }
  const amount = view.sends?.amountTenths ?? approvalAmount(view) ?? requestAmountTenths(request);
  const posts = `Approving re-checks ESPN, then makes the swap and posts ${amount === null ? "the adjustment" : signedPoints(amount)}.`;
  if (request.expiresAt === null) return posts;
  return `${posts} If it isn't approved by ${when(request.expiresAt, reading)}, it's marked expired and stays in Needs you, where you can still approve it or settle it by hand.`;
}

function approvalAmount(view: Found): number | null {
  return view.approval === null
    ? null
    : (view.approval.overrideTenths ?? view.approval.computedTenths);
}

function reviewStatus(view: Found, reading: Reading): DetailStatusWords {
  const { request } = view;
  const reason = request.reviewReason;
  if (reason === null) return { tone: "wait", word: "Needs you", who: "", sentence: "" };
  const pill = REASON_PILLS[reason];
  const subject = {
    teamId: request.teamId,
    teamName: view.names.team,
    injured: { playerId: request.injuredPlayerId, name: request.injuredName },
    filedAt: request.filedAt,
    matchupPeriodId: request.matchupPeriodId,
  };
  return {
    tone: "wait",
    // "Check ESPN" keeps its capitals; the rest read in lower case after the colon.
    word: `Needs you: ${pill.charAt(0).toLowerCase()}${pill.slice(1)}`,
    who: "",
    sentence:
      DETAIL_SENTENCES[reason]?.(view) ?? reasonSentence(subject, reason, view.facts, reading),
  };
}

// Where the detail says more than the queue's row (FS-DETAIL-9, -10, -11, FM-DETAIL-11).
const DETAIL_SENTENCES: Partial<Record<ReviewReason, (view: Found) => string>> = {
  adjustment_held_rules: (view) => {
    const [first] = view.facts?.mismatches ?? [];
    const rule =
      first === undefined
        ? "The league's rules on ESPN differ from InjurySub's."
        : first.kind === "setting"
          ? `${first.setting} is ${first.espn} on ESPN; InjurySub expects ${first.expected}.`
          : `${first.name} scored ${first.espnPoints} on ESPN; InjurySub's formula gives ${first.formulaPoints}.`;
    return `Lineup done. ${rule} Fix it on ESPN and re-approve, or post the adjustment by hand.`;
  },
  adjustment_changed: (view) => {
    const facts = view.facts;
    if (facts?.approvedTenths == null || facts.heldTenths === null) {
      return "The amount changed after you approved it.";
    }
    return `The amount changed from ${signedPoints(facts.approvedTenths)} to ${signedPoints(facts.heldTenths)} after you approved.`;
  },
  stale: (view) =>
    `${managerOf(view)}'s lineup changed on ESPN after the request; nothing was sent. Approving re-checks and sends the change below if it still moves at most one other starter.`,
  ambiguous: () => "ESPN's lineup didn't match after the change. No adjustment was posted.",
};

type CompareSide = { k: string; v: string; s: string };

// The two amounts side by side, for a held or a changed adjustment (FS-DETAIL-10, -11).
export function comparePanel(
  view: Found,
  reading: Reading
): { title: string; left: CompareSide; right: CompareSide } | null {
  const reason = view.request.status === "needs_review" ? view.request.reviewReason : null;
  const held = view.facts?.heldTenths ?? view.approval?.computedTenths ?? null;
  const amount = (tenths: number | null) => (tenths === null ? "—" : signedPoints(tenths));
  if (reason === "adjustment_held_rules") {
    const steps = view.instructions;
    const now = steps.status === "ready" ? (steps.adjustment?.currentTenths ?? null) : null;
    return {
      title: "Re-approving posts",
      left: { k: "Computed", v: amount(held), s: "From box scores" },
      right: {
        k: "On ESPN now",
        v: now === null ? "—" : (now / 10).toFixed(1).replace("-", "−"),
        s: `${teamOf(view)}, week ${view.request.matchupPeriodId}`,
      },
    };
  }
  if (reason === "adjustment_changed") {
    const approvedAt = lastEventAt(view, "approved");
    return {
      title: "Both amounts",
      left: {
        k: "When you approved",
        v: amount(view.facts?.approvedTenths ?? null),
        s: approvedAt === null ? "" : when(approvedAt, reading),
      },
      right: { k: "Now", v: amount(held), s: "" },
    };
  }
  return null;
}

function queuedStatus(view: Found, reading: Reading): DetailStatusWords {
  if (view.blocked === null) {
    return { tone: "busy", word: "In line", who: "InjurySub acts next", sentence: "" };
  }
  const since = view.blockedSince === null ? "" : ` at ${when(view.blockedSince, reading)}`;
  const delayed = `${managerOf(view)} sees "delayed".`;
  if (view.blocked === "credentials_rejected") {
    return {
      tone: "busy",
      word: "In line · blocked",
      who: "You renew the ESPN cookie",
      sentence: `ESPN refused InjurySub's access${since}, so nothing was sent. ${delayed} It re-checks ESPN before sending once access is back.`,
    };
  }
  if (view.blocked === "not_connected") {
    return {
      tone: "busy",
      word: "In line · blocked",
      who: "You connect ESPN",
      sentence: `No ESPN cookie on the host yet, so nothing was sent. ${delayed}`,
    };
  }
  return {
    tone: "busy",
    word: "In line · blocked",
    who: "InjurySub waits for ESPN",
    sentence: `ESPN stopped answering InjurySub${since}, so nothing was sent. ${delayed} It re-checks ESPN before sending once ESPN answers.`,
  };
}

function settledStatus(view: Found, reading: Reading): DetailStatusWords {
  const { request } = view;
  const manager = managerOf(view);
  const at = (type: string) => {
    const time = lastEventAt(view, type);
    return time === null ? "" : ` ${when(time, reading)}`;
  };
  switch (request.status) {
    case "completed":
      return {
        tone: "ok",
        word: "Done",
        who: `On ESPN${at("completed")}`,
        sentence: doneSentence(view),
      };
    case "completed_manually":
      return {
        tone: "ok",
        word: "Done by you",
        who: `Marked done${at("completed_manually")}`,
        sentence: "",
      };
    case "rejected":
      return {
        tone: "neutral",
        word: "Rejected",
        who: "",
        sentence: `${manager} sees your reason.`,
      };
    case "withdrawn":
      return {
        tone: "neutral",
        word: "Withdrawn",
        who: "",
        sentence: `${manager} withdrew it; nothing was sent.`,
      };
    case "refused":
      return {
        tone: "neutral",
        word: "Refused",
        who: "",
        sentence: "Refused at filing; nothing was sent.",
      };
    default:
      return {
        tone: "neutral",
        word: "Reversed",
        who: "",
        sentence: `Marked reversed${at("reversed")}.`,
      };
  }
}

function doneSentence(view: Found): string {
  const { request } = view;
  const amount = requestAmountTenths(request);
  const swap = `${surname(request.replacementName)} at ${request.injuredSlot}`;
  if (amount === null || amount === 0) return `${swap}; no adjustment.`;
  return `${swap}; ${signedPoints(amount)} on ${teamOf(view)}, week ${request.matchupPeriodId}.`;
}

export type DetailActions = {
  primary:
    | { kind: "approve" | "reapprove"; label: string; shownTenths: number }
    | { kind: "form"; form: "complete" | "complete-adjustment"; label: string }
    | null;
  // Text buttons, each opening its form on this page; Reject last.
  links: { form: "override" | "complete" | "complete-adjustment" | "reject"; label: string }[];
};

// One primary action, then the others as text buttons, Reject last (FS-DETAIL-3, -5, -17).
export function detailActions(view: Found, reading: Reading): DetailActions {
  const { actions } = view;
  const primary = primaryAction(view, reading);
  const links: DetailActions["links"] = [];
  const reason = view.request.status === "needs_review" ? view.request.reviewReason : null;
  // A held or changed amount's lineup is done: only the adjustment is left to post by hand.
  if (reason === "adjustment_held_rules" || reason === "adjustment_changed") {
    const adjustmentOnly = {
      form: "complete-adjustment",
      label: "Adjustment only, by hand",
    } as const;
    // Without a re-approval on offer, posting the adjustment by hand leads.
    if (primary?.kind === "form") {
      const links: DetailActions["links"] = actions.includes("override")
        ? [{ form: "override", label: "Override amount" }]
        : [];
      return { primary: { kind: "form", ...adjustmentOnly }, links };
    }
    if (actions.includes("complete")) links.push(adjustmentOnly);
    if (actions.includes("override")) links.push({ form: "override", label: "Override amount" });
    return { primary, links };
  }
  if (actions.includes("override")) links.push({ form: "override", label: "Override amount" });
  if (actions.includes("complete") && primary?.kind !== "form") {
    links.push({ form: "complete", label: "Settle by hand" });
  }
  if (actions.includes("reject")) links.push({ form: "reject", label: "Reject" });
  return { primary, links };
}

function primaryAction(view: Found, reading: Reading): DetailActions["primary"] {
  const { approval, actions } = view;
  if (approval !== null) {
    const amount = signedPoints(approval.overrideTenths ?? approval.computedTenths);
    const label =
      approval.action === "reapprove"
        ? `Re-approve · ${amount}`
        : reading.ownTeam
          ? `Approve your own request · ${amount}`
          : `Approve and run · ${amount}`;
    return { kind: approval.action, label, shownTenths: approval.computedTenths };
  }
  if (actions.includes("complete")) {
    return { kind: "form", form: "complete", label: "Mark done by hand" };
  }
  return null;
}

// FS-DETAIL-18: only a refusal is named; any other failure can't say why (daily limit or outage).
export function emailMark(alertEmail: AlertEmailState, reading: Reading): string | null {
  if (alertEmail.state !== "failed") return null;
  if (alertEmail.code === "send_rejected") {
    return `The alert email for this request didn't go out: the email provider refused it at ${when(alertEmail.at, reading)}.`;
  }
  return `The alert email for this request didn't go out at ${when(alertEmail.at, reading)}.`;
}

const SNAPSHOT_WORDS: Record<string, string> = {
  request: "at filing",
  preflight: "before sending",
  lineup_verified: "after the lineup change",
  adjustment_verified: "after the adjustment",
  manual_completion: "when you settled it by hand",
};

// The whole record, open (FS-DETAIL-19, -20): each event and each ESPN snapshot, in time order.
export function detailRecord(view: Found, reading: Reading): { time: string; text: string }[] {
  const title = `${surname(view.request.replacementName)} in for ${surname(view.request.injuredName)}`;
  const events = view.events.map((event, index) => ({
    at: event.createdAt,
    rank: index * 2,
    text: eventText(view, event.eventType, title, event.payload),
  }));
  // The filing's snapshot sits right after the filing; the others after their time's events.
  const snapshots = view.snapshots.map((snapshot, index) => ({
    at: snapshot.takenAt,
    rank: snapshot.phase === "request" ? 1 : 10_000 + index,
    text: `ESPN snapshot taken ${SNAPSHOT_WORDS[snapshot.phase] ?? snapshot.phase.replaceAll("_", " ")}`,
  }));
  return [...events, ...snapshots]
    .sort((a, b) => a.at.getTime() - b.at.getTime() || a.rank - b.rank)
    .map(({ at, text }) => ({ time: when(at, reading), text }));
}

function eventText(view: Found, type: string, title: string, payload: unknown): string {
  if (!isRequestEventType(type)) return type.replaceAll("_", " ");
  if (type === "request_filed") {
    const manager = view.names.manager === null ? null : commissionerWord(view.names.manager);
    if (view.request.kind === "on_behalf") {
      return `You filed for ${manager ?? "the manager"}: ${title}`;
    }
    return `${manager ?? "The manager"} asked: ${title}`;
  }
  return commissionerVoiced(type, title, selfApprovalOf(payload));
}

// The manager's record words, with the commissioner as "you".
function commissionerVoiced(type: RequestEventType, title: string, selfApproval = false): string {
  return recordText(type, title, "You", { selfApproval }).replace(/ (to|for) You\b/, " $1 you");
}
