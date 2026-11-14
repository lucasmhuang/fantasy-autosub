import { DEFAULT_READ_TIMEOUT_MS, DEFAULT_WRITE_TIMEOUT_MS } from "@injurysub/espn";
import { describe, expect, it } from "vitest";
import { LEASE_TTL_SECONDS } from "./claim";
import { READBACK_INTERVAL_MS, READBACK_ROUNDS } from "./espn-write";

// The reads between a lineup's readback and the adjustment's send, each under its own deadline:
// readFacts' getTeamWeek and checkLeagueRules, then readMatchup's getCurrentWeek
// (adjustment-step.ts). Every other stretch between two renewals is shorter.
const READS_BEFORE_ADJUSTMENT_SEND = 3;

// The ESPN time in the longest stretch a pass goes without renewing the lease: from the check
// before a lineup send, the send, every readback round with its pauses, and the reads before the
// adjustment's send, whose check renews it again. The stretch's database statements (about 24,
// each under the pool's 7 s statement timeout) aren't counted, so this isn't a bound on the
// stretch, only on its ESPN waits.
const longestStretchMs =
  DEFAULT_WRITE_TIMEOUT_MS +
  READBACK_ROUNDS * DEFAULT_READ_TIMEOUT_MS +
  (READBACK_ROUNDS - 1) * READBACK_INTERVAL_MS +
  READS_BEFORE_ADJUSTMENT_SEND * DEFAULT_READ_TIMEOUT_MS;

// The margin keeps a takeover mid-pass rare; the token and the request's version keep it safe.
describe("the ESPN-write lease", () => {
  it("outlasts the ESPN waits in the longest stretch a pass goes without renewing it, twice over", () => {
    expect(LEASE_TTL_SECONDS * 1000).toBeGreaterThanOrEqual(2 * longestStretchMs);
  });
});
