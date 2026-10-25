import { describe, expect, it } from "vitest";
import { AppError } from "./errors";

class ProbeError extends AppError {
  override readonly name = "ProbeError";
}

describe("AppError", () => {
  it("keeps the cause it's given, for the logger to serialize", () => {
    const cause = new Error("socket hang up");

    expect(new ProbeError("probe failed", { cause }).cause).toBe(cause);
  });
});

// Compile-time contract, checked by `pnpm typecheck`.
// @ts-expect-error A subclass must name itself: that name is what the logs show.
class UnnamedError extends AppError {}

// @ts-expect-error A cause must be an Error: the logger writes any other cause in full.
new ProbeError("probe failed", { cause: { headers: { cookie: "espn_s2=synthetic" } } });
