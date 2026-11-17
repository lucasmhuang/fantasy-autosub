import { formatRecentMoment, type ReviewReason, type SubRequestStatus } from "@injurysub/domain";
import type { RuleMismatch } from "@injurysub/espn";
import type { HealthCheck, RowStatus } from "@injurysub/ui";
import type { QueueAlert, QueueHealth, QueueRequest, ReviewFacts } from "../../lib/server/queue";
import { requestPill, signedPoints } from "../board/board-copy";
import { surname } from "../board/option-copy";

type Reading = { zone: string; now: Date };

export type QueueRowWords = {
  team: string;
  swap: string;
  when: string;
  amount: string;
  needs?: { reason: string; sentence: string };
  status?: RowStatus;
};

const when = (instant: Date, reading: Reading) =>
  formatRecentMoment(instant, reading.zone, reading.now);
const teamOf = (teamId: number | null, teamName: string | null) =>
  teamName ?? (teamId === null ? "a team" : `Team ${teamId}`);

const STOPPED: readonly SubRequestStatus[] = ["rejected", "withdrawn", "refused", "reversed"];

// "−22.6 proj." while projected; "—" for a stopped request or no adjustment.
function amountText(row: QueueRequest): string {
  if (STOPPED.includes(row.status) || row.amountTenths === null || row.amountTenths === 0) {
    return "—";
  }
  const points = signedPoints(row.amountTenths);
  return row.amountFinal ? points : `${points} proj.`;
}

// One request's row: who, the swap, when it was filed and its amount, then why it needs the
// commissioner (FS-QUEUE-5) or its status, done by hand as their own (FS-QUEUE-7).
export function requestRowWords(row: QueueRequest, reading: Reading): QueueRowWords {
  const words = {
    team: teamOf(row.teamId, row.teamName),
    swap: `${surname(row.replacement.name)} in for ${surname(row.injured.name)}`,
    when: when(row.filedAt, reading),
    amount: amountText(row),
  };
  if (row.status === "awaiting_approval") {
    const sentence =
      row.expiresAt === null
        ? "Waiting for your approval."
        : `Expires ${when(row.expiresAt, reading)}.`;
    return { ...words, needs: { reason: "Approval", sentence } };
  }
  if (row.status === "needs_review" && row.reviewReason !== null) {
    return { ...words, needs: reasonWords(row, row.reviewReason, row.facts, reading) };
  }
  return { ...words, status: requestPill(row.status, "you") };
}

export const REASON_PILLS: Record<ReviewReason, string> = {
  automation_off: "Automation off",
  not_allowlisted: "Not enabled",
  rearrangement: "Rearrangement",
  suspension: "Suspension",
  stale: "Lineup changed",
  ambiguous: "Check ESPN",
  lineup_failed: "Lineup failed",
  adjustment_failed: "Adjustment failed",
  adjustment_held_rules: "Adjustment held",
  adjustment_changed: "Amount changed",
  expired: "Expired",
  week_ended: "Week ended",
  playoffs: "Playoffs",
};

function reasonWords(
  row: QueueRequest,
  reason: ReviewReason,
  facts: ReviewFacts | null,
  reading: Reading
): { reason: string; sentence: string } {
  return { reason: REASON_PILLS[reason], sentence: reasonSentence(row, reason, facts, reading) };
}

const COUNT_WORDS = ["No", "One", "Two", "Three", "Four", "Five"];

// The facts of a request a reason's sentence names: the queue's row and the detail's status line.
export type ReasonSubject = Pick<
  QueueRequest,
  "teamId" | "teamName" | "injured" | "filedAt" | "matchupPeriodId"
>;

export function reasonSentence(
  row: ReasonSubject,
  reason: ReviewReason,
  facts: ReviewFacts | null,
  reading: Reading
): string {
  switch (reason) {
    case "automation_off":
      return "Automation is off.";
    case "not_allowlisted":
      return `${teamOf(row.teamId, row.teamName)} isn't ticked in Settings.`;
    case "rearrangement":
      return rearrangementSentence(facts?.otherMoves ?? []);
    case "suspension":
      return `${surname(row.injured.name)} is suspended, not OUT.`;
    case "stale":
      return "Lineup changed on ESPN after the request; nothing was sent.";
    case "ambiguous":
      return "ESPN's lineup didn't match after the change.";
    case "lineup_failed":
      return facts?.reviewedAt
        ? `ESPN refused the lineup change at ${when(facts.reviewedAt, reading)}; nothing else was sent.`
        : "ESPN refused the lineup change; nothing else was sent.";
    case "adjustment_failed":
      return facts === null || facts.sentTenths === null
        ? "Lineup done; the adjustment wasn't posted."
        : `Lineup done; ESPN refused the ${signedPoints(facts.sentTenths)} adjustment.`;
    case "adjustment_held_rules":
      return heldRulesSentence(facts?.mismatches ?? []);
    case "adjustment_changed":
      return changedSentence(facts);
    case "expired":
      return `Waited 12 hours without running (filed ${when(row.filedAt, reading)}).`;
    case "week_ended":
      return `Week ${row.matchupPeriodId} ended before it ran; post the adjustment only.`;
    case "playoffs":
      return "Playoff weeks always come to you.";
  }
}

function rearrangementSentence(moves: ReviewFacts["otherMoves"]): string {
  if (moves.length === 0) return "Other starters would move.";
  const count = COUNT_WORDS[moves.length] ?? String(moves.length);
  const list = moves.map(({ name, toSlot }) => `${surname(name)} to ${toSlot}`).join(", ");
  return `${count} other starters would move: ${list}.`;
}

function heldRulesSentence(mismatches: RuleMismatch[]): string {
  const [first] = mismatches;
  if (first === undefined) return "League rules differ.";
  if (first.kind === "setting") {
    return `League rules differ: ${first.setting} is ${first.espn} on ESPN, InjurySub expects ${first.expected}.`;
  }
  return `League rules differ: ${first.name} scored ${first.espnPoints} on ESPN, InjurySub's formula gives ${first.formulaPoints}.`;
}

function changedSentence(facts: ReviewFacts | null): string {
  if (facts === null || facts.approvedTenths === null || facts.heldTenths === null) {
    return "The amount changed after you approved it.";
  }
  return `${signedPoints(facts.approvedTenths)} when you approved, ${signedPoints(facts.heldTenths)} now.`;
}

const ALERT_SUMMARIES: Record<QueueAlert["alertKind"], (team: string) => string> = {
  lm_transaction: (team) => `A lineup change on ${team} InjurySub didn't make`,
  lm_adjustment: (team) => `A score adjustment on ${team} InjurySub didn't make`,
  lm_league_change: () => "A league setting change InjurySub didn't make",
  adjustment_mismatch: (team) => `${team}'s adjustment on ESPN differs from InjurySub's`,
  league_public: () => "The league was made public",
};

// A misuse alert's row in "Needs you" (FS-QUEUE-6).
export function alertRowWords(alert: QueueAlert, reading: Reading): QueueRowWords {
  return {
    team: "Misuse watch",
    swap: ALERT_SUMMARIES[alert.alertKind](teamOf(alert.teamId, alert.teamName)),
    when: when(alert.at, reading),
    amount: "—",
    needs: { reason: "Alert", sentence: "Acknowledge it, or undo it on ESPN." },
  };
}

// A rule as the health row names it.
export function mismatchSentence(mismatch: RuleMismatch): string {
  if (mismatch.kind === "setting") {
    return `${mismatch.setting}: ESPN has ${mismatch.espn}, InjurySub expects ${mismatch.expected}.`;
  }
  return `${mismatch.name}: ESPN scored ${mismatch.espnPoints}, InjurySub's formula gives ${mismatch.formulaPoints}.`;
}

function espnCheck(health: QueueHealth, reading: Reading): HealthCheck {
  const { espn, blockedCount } = health;
  const name = "ESPN";
  if (espn === null) return { name, mark: "off", state: "Not checked yet" };
  switch (espn.state) {
    case "working":
      return {
        name,
        mark: "ok",
        state: "Working",
        when: `checked ${when(espn.checkedAt, reading)}`,
      };
    case "credentials_rejected":
      return {
        name,
        mark: "bad",
        state: "Access refused",
        when: when(espn.since, reading),
        detail: refusedDetail(blockedCount),
      };
    case "unreachable":
      return {
        name,
        mark: "bad",
        state: "Can't be reached",
        when: when(espn.since, reading),
        detail: "Requests wait and re-check ESPN before sending.",
      };
    case "not_connected":
      return {
        name,
        mark: "off",
        state: "Not connected",
        detail: "No ESPN cookie on the host yet. Every request comes to you.",
      };
  }
}

function refusedDetail(blocked: number): string {
  const managers = 'their managers see "delayed".';
  if (blocked === 0) return `Renew the ESPN cookie on the host. Requests wait; ${managers}`;
  const count = blocked === 1 ? "1 request is blocked" : `${blocked} requests are blocked`;
  return `Renew the ESPN cookie on the host. ${count}; ${managers}`;
}

function workerCheck({ worker }: QueueHealth, reading: Reading): HealthCheck {
  const name = "Swap runner";
  if (!worker.down && worker.lastBeatAt !== null) {
    return { name, mark: "ok", state: "Running", when: when(worker.lastBeatAt, reading) };
  }
  return {
    name,
    mark: "bad",
    state: "Not running",
    ...(worker.lastBeatAt === null
      ? {}
      : { when: `last seen ${when(worker.lastBeatAt, reading)}` }),
    detail: "Requests in line show as not started. Nothing is sent until it's back.",
  };
}

function rulesCheck({ espn, rules }: QueueHealth, reading: Reading): HealthCheck {
  const name = "League rules";
  if (espn?.state !== "working") {
    const lastMatched = rules?.lastMatchedAt ?? null;
    return {
      name,
      mark: "off",
      state: "Not checked",
      ...(lastMatched === null ? {} : { when: `last matched ${when(lastMatched, reading)}` }),
    };
  }
  if (rules === null) return { name, mark: "off", state: "Not checked yet" };
  if (rules.mismatches.length === 0) {
    return { name, mark: "ok", state: "Match", when: `checked ${when(rules.checkedAt, reading)}` };
  }
  return {
    name,
    mark: "warn",
    state: `${rules.mismatches.length} differ`,
    when: when(rules.checkedAt, reading),
    detail: `${rules.mismatches.map(mismatchSentence).join(" ")} Adjustments wait for you.`,
  };
}

function watchCheck({ watch }: QueueHealth, reading: Reading): HealthCheck {
  const base = { name: "Misuse watch", href: "/commish/alerts" };
  switch (watch.state) {
    case "watching":
      return {
        ...base,
        mark: "ok",
        state: "Watching",
        when: `checked ${when(watch.checkedAt, reading)}`,
      };
    case "paused":
      return {
        ...base,
        mark: "bad",
        state: "Paused",
        when: when(watch.since, reading),
        detail: "Can't read ESPN's log, so nothing is being checked. You were emailed.",
      };
    case "not_started":
      return { ...base, mark: "off", state: "Not started" };
  }
}

// The health panel's checks (FS-QUEUE-1, FS-QUEUE-2, FM-QUEUE-2 to -7), the time its one line
// shows while they all work, and the misuse watch on its own line (Revision 2).
export function healthWords(
  health: QueueHealth,
  reading: Reading
): { checks: HealthCheck[]; summaryWhen: string; separate: HealthCheck } {
  const times = [health.espn?.checkedAt, health.worker.lastBeatAt, health.rules?.checkedAt]
    .filter((each): each is Date => each instanceof Date)
    .map((each) => each.getTime());
  const latest = times.length === 0 ? reading.now : new Date(Math.max(...times));
  return {
    checks: [espnCheck(health, reading), workerCheck(health, reading), rulesCheck(health, reading)],
    summaryWhen: when(latest, reading),
    separate: watchCheck(health, reading),
  };
}
