export type DayPoints = { day: number; tenths: number };

export type AdjustmentInput = {
  matchupDays: number[];
  requestDay: number;
  effectiveDay: number;
  injured: { playerId: number; creditedDays: DayPoints[]; earlierCredits: DayPoints[] };
  replacement: { playerId: number; days: DayPoints[]; tenthsAtRequest: number };
};

export type AdjustmentLineReason =
  | "injured_credited_before_swap"
  | "earlier_credit_forfeited"
  | "replacement_after_request"
  | "replacement_on_bench"
  | "replacement_before_request";

export type AdjustmentLine = {
  day: number;
  playerId: number;
  tenths: number;
  why: AdjustmentLineReason;
};

export type AdjustmentResult =
  | { ok: true; totalTenths: number; lines: AdjustmentLine[] }
  | { ok: false; reason: "effective_day_before_request_day" | "request_day_outside_matchup" };

// The adjustment that makes a team's total what it would have been had the swap applied at the
// request moment (the owner's request-time cutoff, 2026-10-29). ESPN's lineup credits the injured
// starter on every day before the effective day E and the replacement from E on, so the adjustment
// removes the starter's credited days before E, gives the replacement what he scored from the
// request moment until E, and, when E is the request's day d, takes back his points from before
// the request. A player injured after an earlier request credited him also forfeits that credit.
export function computeAdjustment(input: AdjustmentInput): AdjustmentResult {
  const { requestDay, effectiveDay } = input;
  if (!input.matchupDays.includes(requestDay)) {
    return { ok: false, reason: "request_day_outside_matchup" };
  }
  if (effectiveDay < requestDay) return { ok: false, reason: "effective_day_before_request_day" };

  const lines = [...injuredLines(input), ...replacementLines(input)]
    .filter((line) => line.tenths !== 0)
    .sort((a, b) => a.day - b.day);
  const totalTenths = lines.reduce((sum, line) => sum + line.tenths, 0);
  return { ok: true, totalTenths, lines };
}

function injuredLines({ injured, effectiveDay }: AdjustmentInput): AdjustmentLine[] {
  const { playerId } = injured;
  const forfeited = injured.earlierCredits.map(({ day, tenths }) => ({
    day,
    playerId,
    tenths: -tenths,
    why: "earlier_credit_forfeited" as const,
  }));
  const credited = injured.creditedDays
    .filter(({ day }) => day < effectiveDay)
    .map(({ day, tenths }) => ({
      day,
      playerId,
      tenths: -tenths,
      why: "injured_credited_before_swap" as const,
    }));
  return [...forfeited, ...credited];
}

function replacementLines({
  replacement,
  requestDay,
  effectiveDay,
}: AdjustmentInput): AdjustmentLine[] {
  const { playerId, tenthsAtRequest } = replacement;
  if (effectiveDay === requestDay) {
    return [
      { day: requestDay, playerId, tenths: -tenthsAtRequest, why: "replacement_before_request" },
    ];
  }
  return replacement.days
    .filter(({ day }) => day >= requestDay && day < effectiveDay)
    .map(({ day, tenths }) =>
      day === requestDay
        ? {
            day,
            playerId,
            tenths: tenths - tenthsAtRequest,
            why: "replacement_after_request" as const,
          }
        : { day, playerId, tenths, why: "replacement_on_bench" as const }
    );
}
