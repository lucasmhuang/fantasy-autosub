import { DEFAULT_READ_TIMEOUT_MS, DEFAULT_WRITE_TIMEOUT_MS } from "@injurysub/espn";
import { describe, expect, it } from "vitest";
import { LEASE_TTL_SECONDS } from "./claim";
import { READBACK_INTERVAL_MS, READBACK_ROUNDS } from "./espn-write";

// The reads between a lineup's readback and the adjustment's send, each under its own deadline:
// readFacts' getTeamWeek and checkLeagueRules, then readMatchup's getCurrentWeek
// (adjustment-step.ts). Every other stretch between two renewals is shorter.
const READS_BEFORE_ADJUSTMENT_SEND = 3;

// The longest a pass goes without renewing the lease: from the check before a lineup send, the
// send, every readback round with its pauses, and the reads before the adjustment's send, whose
// check renews it again. Every wait in a pass has a deadline, so this is a bound.
const longestStretchMs =
  DEFAULT_WRITE_TIMEOUT_MS +
  READBACK_ROUNDS * DEFAULT_READ_TIMEOUT_MS +
  (READBACK_ROUNDS - 1) * READBACK_INTERVAL_MS +
  READS_BEFORE_ADJUSTMENT_SEND * DEFAULT_READ_TIMEOUT_MS;

// A takeover then comes only once the last pass is over (or its worker gone): a second worker's
// recovery never reads ESPN while the first is still reading back its write.
describe("the ESPN-write lease", () => {
  it("outlasts the longest stretch a pass goes without renewing it, twice over", () => {
    expect(LEASE_TTL_SECONDS * 1000).toBeGreaterThanOrEqual(2 * longestStretchMs);
  });
});
