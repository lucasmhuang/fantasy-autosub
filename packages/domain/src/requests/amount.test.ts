import { describe, expect, it } from "vitest";
import { requestAmountTenths } from "./amount";

const none = {
  finalAdjustmentTenths: null,
  overrideAdjustmentTenths: null,
  projectedAdjustmentTenths: null,
};

describe("requestAmountTenths", () => {
  it("is the amount applied once there is one, over an override or the projection", () => {
    expect(
      requestAmountTenths({
        finalAdjustmentTenths: 0,
        overrideAdjustmentTenths: -120,
        projectedAdjustmentTenths: -226,
      })
    ).toBe(0);
  });

  it("is the commissioner's override before then, over the projection", () => {
    expect(
      requestAmountTenths({
        ...none,
        overrideAdjustmentTenths: -120,
        projectedAdjustmentTenths: -226,
      })
    ).toBe(-120);
  });

  it("is Confirm's projection with neither, and none without one", () => {
    expect(requestAmountTenths({ ...none, projectedAdjustmentTenths: -226 })).toBe(-226);
    expect(requestAmountTenths(none)).toBe(null);
  });
});
