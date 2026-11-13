// One ESPN write attempt, as the executor records it: what it wrote, what ESPN answered, and what
// a read of ESPN showed afterwards. ESPN's answer is never proof; the readback's outcome is.
export const espnWriteKinds = ["lineup", "adjustment"] as const;
export type EspnWriteKind = (typeof espnWriteKinds)[number];

// sending: recorded, about to go out (a crash here leaves only this). answered: ESPN accepted it.
// failed: an error came back (its code says whether it may have applied). recorded_only: never
// sent, in rehearsal.
export const espnWriteStatuses = ["sending", "answered", "failed", "recorded_only"] as const;
export type EspnWriteStatus = (typeof espnWriteStatuses)[number];

export const espnWriteOutcomes = ["verified", "not_applied", "ambiguous"] as const;
export type EspnWriteOutcome = (typeof espnWriteOutcomes)[number];
