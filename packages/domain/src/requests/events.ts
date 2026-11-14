// What a request's audit log records. Event types are stored as text checked against this list,
// not a database enum, since the log keeps gaining kinds and each enum value is a migration.
export const requestEventTypes = [
  "request_filed",
  "request_refused",
  "approved",
  "reapproved",
  "rejected",
  "withdrawn",
  "override_set",
  "completed_manually",
  "reversed",
  "expired",
  "week_ended",
  "claimed",
  "preflight_passed",
  "sent_to_review",
  "lineup_sent",
  "lineup_verified",
  "adjustment_held",
  "adjustment_sent",
  "adjustment_verified",
  "completed",
  "requeued",
  "proving_side_read",
] as const;
export type RequestEventType = (typeof requestEventTypes)[number];

export function isRequestEventType(value: string): value is RequestEventType {
  return (requestEventTypes as readonly string[]).includes(value);
}

export const requestActorTypes = ["manager", "commissioner", "system"] as const;
export type RequestActorType = (typeof requestActorTypes)[number];

// When an ESPN snapshot was taken for a request; each is kept unchanged.
export const requestSnapshotPhases = [
  "request",
  "preflight",
  "lineup_verified",
  "adjustment_verified",
  "manual_completion",
] as const;
export type RequestSnapshotPhase = (typeof requestSnapshotPhases)[number];

// Whether the replacement's points at the request moment were read from ESPN or entered by the
// commissioner for an on-behalf request.
export const snapshotSources = ["observed", "entered_by_hand"] as const;
export type SnapshotSource = (typeof snapshotSources)[number];
