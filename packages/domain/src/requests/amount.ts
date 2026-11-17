// What a request's adjustment is or would be: the amount applied once it's settled, else the
// commissioner's override, else Confirm's projection; null with none. Every completion applies the
// override when one is set, so the first two differ only on a proving run put back by hand (0).
export function requestAmountTenths(request: {
  finalAdjustmentTenths: number | null;
  overrideAdjustmentTenths: number | null;
  projectedAdjustmentTenths: number | null;
}): number | null {
  return (
    request.finalAdjustmentTenths ??
    request.overrideAdjustmentTenths ??
    request.projectedAdjustmentTenths
  );
}
