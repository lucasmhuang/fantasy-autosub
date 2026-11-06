import { formatTenths } from "@injurysub/domain";
import type { AdjustmentFigures } from "../../lib/server/commish";

const points = (tenths: number) => `${formatTenths(tenths, { signed: true })} points`;

// Q8: the computed amount always shows; an override is shown beside it, never in its place.
export function AdjustmentSummary({ figures }: { figures: AdjustmentFigures }) {
  const { computedTenths, overrideTenths, appliedTenths } = figures;
  const computed = computedTenths ?? 0;
  if (appliedTenths !== null) {
    return (
      <>
        <p className="font-medium">Adjustment applied: {points(appliedTenths)}</p>
        {overrideTenths === null ? null : (
          <p className="text-[color:var(--muted)]">
            Your override. The computed amount was {points(computed)}.
          </p>
        )}
      </>
    );
  }
  if (overrideTenths !== null) {
    return (
      <>
        <p className="font-medium">Your override: {points(overrideTenths)}</p>
        <p className="text-[color:var(--muted)]">
          Computed: {points(computed)}. The override is what gets applied.
        </p>
      </>
    );
  }
  return (
    <p className="font-medium">
      {computed === 0 ? "No adjustment." : `Computed adjustment: ${points(computed)}`}
    </p>
  );
}
