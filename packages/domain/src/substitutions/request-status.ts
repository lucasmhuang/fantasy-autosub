export const substitutionRequestStatuses = [
  "queued",
  "executing",
  "pending_review",
  "stale_requires_review",
  "fallback_required",
  "rejected",
  "executed",
  "failed",
  "reversed"
] as const;

export type SubstitutionRequestStatus =
  (typeof substitutionRequestStatuses)[number];

