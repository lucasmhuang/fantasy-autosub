// What happens to a request's adjustment once its lineup is verified on ESPN.
export type AdjustmentDecision =
  | { kind: "write"; finalTenths: number; computedTenths: number }
  | { kind: "none"; computedTenths: number }
  | { kind: "held"; reason: "adjustment_held_rules"; computedTenths: number }
  | {
      kind: "held";
      reason: "adjustment_changed";
      computedTenths: number;
      approvedComputedTenths: number;
      overrideTenths: number | null;
    };

// Held while ESPN's league rules differ from the ones the amount is computed with (X17), and held
// for re-approval when the amount computed now differs from the one computed at approval: the
// computed amounts are compared, never an override, which is written as set while they agree
// (S4, AC1-1, AC2-4). Otherwise the final amount (the override, or the computed one) is written,
// or nothing when it is zero (X12).
export function decideAdjustment(input: {
  rulesMatch: boolean;
  computedTenths: number;
  approvedComputedTenths: number | null;
  overrideTenths: number | null;
}): AdjustmentDecision {
  const { computedTenths, approvedComputedTenths, overrideTenths } = input;
  if (!input.rulesMatch) return { kind: "held", reason: "adjustment_held_rules", computedTenths };
  if (approvedComputedTenths !== null && computedTenths !== approvedComputedTenths) {
    const reason = "adjustment_changed";
    return { kind: "held", reason, computedTenths, approvedComputedTenths, overrideTenths };
  }
  const finalTenths = overrideTenths ?? computedTenths;
  if (finalTenths === 0) return { kind: "none", computedTenths };
  return { kind: "write", finalTenths, computedTenths };
}
