import { describe, expect, it } from "vitest";
import { isRequestEventType } from "./events";

describe("isRequestEventType", () => {
  it("accepts a known event type and refuses any other text", () => {
    expect(isRequestEventType("request_filed")).toBe(true);
    expect(isRequestEventType("adjustment_verified")).toBe(true);
    expect(isRequestEventType("request_filed ")).toBe(false);
    expect(isRequestEventType("dropped_tables")).toBe(false);
  });
});
