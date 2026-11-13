import { describe, expect, it } from "vitest";
import { espnAccessStateFor } from "./espn-access";

describe("espnAccessStateFor", () => {
  it("is working after a read without an error", () => {
    expect(espnAccessStateFor(null)).toBe("working");
  });

  it("names a refused cookie, and calls every other failure unreachable", () => {
    expect(espnAccessStateFor("credentials_rejected")).toBe("credentials_rejected");
    for (const code of ["espn_unavailable", "unrecognized_response", "league_not_found"]) {
      expect(espnAccessStateFor(code)).toBe("unreachable");
    }
  });
});
