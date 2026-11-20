import {
  commissionerReasonFact,
  firstName,
  formatRecentMoment,
  misuseAlertTitle,
  REASON_PILLS,
  type ReviewReason,
  ruleMismatchWords,
  type SubRequestStatus,
  teamName,
} from "@injurysub/domain";
import type { RuleMismatch } from "@injurysub/espn";
import type { HealthCheck, RowStatus } from "@injurysub/ui";
import type { QueueAlert, QueueHealth, QueueRequest, ReviewFacts } from "../../lib/server/queue";
import { requestPill, signedPoints } from "../board/board-copy";
import { surname } from "../board/option-copy";
import { PAUSED_CAUSE } from "./alerts-copy";

// ownTeamId: the commissioner's own team, whose manager reads "you".
type Reading = { zone: string; now: Date; ownTeamId?: number | null };

export type QueueRowWords = {
  team: string;
  manager?: string;
  swap: string;
  when: string;
  amount: string;
  needs?: { reason: string; sentence?: string };
  status?: RowStatus;
};

const when = (instant: Date, reading: Reading) =>
  formatRecentMoment(instant, reading.zone, reading.now);
const teamOf = (teamId: number | null, name: string | null) =>
  teamId === null ? (name ?? "a team") : teamName(teamId, name);

function managerOf(row: QueueRequest, reading: Reading): { manager?: string } {
  if (row.teamId === reading.ownTeamId) return { manager: "you" };
  const manager = firstName(row.managerName);
  return manager === null ? {} : { manager };
}

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
    ...managerOf(row, reading),
    swap: `${surname(row.replacement.name)} in for ${surname(row.injured.name)}`,
    when: when(row.filedAt, reading),
    amount: amountText(row),
  };
  if (row.status === "awaiting_approval") {
    const needs =
      row.expiresAt === null
        ? { reason: "Approval" }
        : { reason: "Approval", sentence: `Expires ${when(row.expiresAt, reading)}.` };
    return { ...words, needs };
  }
  if (row.status === "needs_review" && row.reviewReason !== null) {
    return { ...words, needs: reasonWords(row, row.reviewReason, row.facts, reading) };
  }
  return { ...words, status: requestPill(row.status, "you") };
}

function reasonWords(
  row: QueueRequest,
  reason: ReviewReason,
  facts: ReviewFacts | null,
  reading: Reading
): { reason: string; sentence?: string } {
  const sentence = reasonSentence(row, reason, facts, reading);
  return sentence === null
    ? { reason: REASON_PILLS[reason] }
    : { reason: REASON_PILLS[reason], sentence };
}

// The facts of a request a reason's sentence names: the queue's row and the detail's status line.
export type ReasonSubject = Pick<QueueRequest, "injured" | "filedAt" | "matchupPeriodId">;

// The reason's one fact (copy table 1, S2), shared with the detail and the alert email.
export function reasonSentence(
  row: ReasonSubject,
  reason: ReviewReason,
  facts: ReviewFacts | null,
  reading: Reading
): string | null {
  const [first] = facts?.mismatches ?? [];
  return commissionerReasonFact(reason, {
    starter: surname(row.injured.name),
    week: row.matchupPeriodId,
    moves: (facts?.otherMoves ?? []).map(({ name, toSlot }) => ({
      name: surname(name),
      slot: toSlot,
    })),
    at: facts?.reviewedAt ? when(facts.reviewedAt, reading) : null,
    espnAnswer: facts?.espnAnswer ?? null,
    sent: facts?.sentTenths == null ? null : signedPoints(facts.sentTenths),
    approved: facts?.approvedTenths == null ? null : signedPoints(facts.approvedTenths),
    held: facts?.heldTenths == null ? null : signedPoints(facts.heldTenths),
    mismatch:
      first === undefined
        ? null
        : { first: ruleMismatchWords(first), more: (facts?.mismatches.length ?? 1) - 1 },
    hours: 12,
    filed: when(row.filedAt, reading),
    offIr: (facts?.offIr ?? []).map(surname),
  });
}

// A misuse alert's row in "Needs you" (FS-QUEUE-6).
export function alertRowWords(alert: QueueAlert, reading: Reading): QueueRowWords {
  return {
    team: "Misuse watch",
    swap: misuseAlertTitle(alert.alertKind, teamOf(alert.teamId, alert.teamName)),
    when: when(alert.at, reading),
    amount: "—",
    needs: { reason: "Alert" },
  };
}

// A rule as the health row names it.
export function mismatchSentence(mismatch: RuleMismatch): string {
  return `${ruleMismatchWords(mismatch)}.`;
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
        state: "Cookie refused",
        when: when(espn.since, reading),
        detail: refusedDetail(blockedCount),
      };
    case "unreachable":
      return {
        name,
        mark: "bad",
        state: "Can't be reached",
        when: when(espn.since, reading),
        detail: "Requests wait.",
      };
    case "not_connected":
      return {
        name,
        mark: "off",
        state: "No cookie",
        detail: "No ESPN cookie yet; every request goes to Needs you.",
      };
  }
}

function refusedDetail(blocked: number): string {
  if (blocked === 0) return "Renew the ESPN cookie on Railway. Managers see Delayed.";
  return `Renew the ESPN cookie on Railway. ${blocked} blocked; their managers see Delayed.`;
}

function workerCheck({ worker }: QueueHealth, reading: Reading): HealthCheck {
  const name = "InjurySub";
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
    detail: "Nothing is sent until it's back; managers see Not started.",
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
        detail: PAUSED_CAUSE[watch.reason],
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
