import { describe, expect, it } from "vitest";
import { espnAccessStateFor, espnBlockFor } from "./espn-access";

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

describe("espnBlockFor", () => {
  it("holds up only a queued request, while the last check found ESPN not working", () => {
    expect(espnBlockFor("queued", "credentials_rejected")).toBe("credentials_rejected");
    expect(espnBlockFor("queued", "unreachable")).toBe("unreachable");
    expect(espnBlockFor("queued", "working")).toBe(null);
    expect(espnBlockFor("queued", null)).toBe(null);
    expect(espnBlockFor("awaiting_approval", "credentials_rejected")).toBe(null);
    expect(espnBlockFor("executing", "credentials_rejected")).toBe(null);
  });
});
