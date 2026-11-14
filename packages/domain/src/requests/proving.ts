import { composeReason, ENTRY_SEPARATOR, targetSideAdjustment } from "../adjustment/ledger";
import type { LineupMove } from "../lineup/classify-options";

// The proving request runs only on the owner's team, the first one the worker may write to.
export const PROVING_TEAM_ID = 1;
// Its token adjustment: 0.1 points on team 1's side, written and then reverted.
export const PROVING_TOKEN_TENTHS = 1;
export const PROVING_REASON_ENTRY = "InjurySub test (reverted)";

export type ProvingTokenPlan =
  | {
      ok: true;
      targetTenths: number;
      reason: string;
      original: { tenths: number; reason: string };
    }
  | { ok: false; refusal: "already_noted" | "too_long" };

// The edit that puts a lineup edit back: its items last to first, each to the slot it came from,
// so each slot is free when its item applies (ESPN took a three-item inverse this way, B13).
export function inverseEdit(items: readonly LineupMove[]): LineupMove[] {
  return items
    .map(({ playerId, fromSlot, toSlot }) => ({ playerId, fromSlot: toSlot, toSlot: fromSlot }))
    .reverse();
}

// The token write for a side as ESPN shows it: 0.1 more, with the test note added beside any
// entries already there, and the side as read, which the revert writes back. A side that still
// carries the test note has an earlier run's token on it, so it gets no second one.
export function planProvingToken(
  side: { currentTenths: number; currentReason: string },
  maxLength: number
): ProvingTokenPlan {
  const entries = side.currentReason.split(ENTRY_SEPARATOR);
  if (entries.includes(PROVING_REASON_ENTRY)) return { ok: false, refusal: "already_noted" };
  const composed = composeReason(side.currentReason, PROVING_REASON_ENTRY, maxLength);
  if (!composed.ok) return { ok: false, refusal: "too_long" };
  return {
    ok: true,
    targetTenths: targetSideAdjustment(side.currentTenths, PROVING_TOKEN_TENTHS),
    reason: composed.reason,
    original: { tenths: side.currentTenths, reason: side.currentReason },
  };
}
