// Whether the worker can read ESPN, as its last check found: working, the cookie refused, or
// ESPN unreachable or answering in a way the reads can't use (the stored code says which).
export const espnAccessStates = ["working", "credentials_rejected", "unreachable"] as const;
export type EspnAccessState = (typeof espnAccessStates)[number];

// The access state an ESPN read leaves: no error code means it worked.
export function espnAccessStateFor(errorCode: string | null): EspnAccessState {
  if (errorCode === null) return "working";
  return errorCode === "credentials_rejected" ? "credentials_rejected" : "unreachable";
}

const HELD_BY_ESPN: readonly string[] = ["queued", "executing"];

// Whether a request is held up by ESPN access (O4, O6): one in line to run, or one in progress
// whose write waits on ESPN's readback, while the worker's last check found ESPN not working.
// Null otherwise, and before any check.
export function espnBlockFor(
  status: string,
  access: EspnAccessState | null
): Exclude<EspnAccessState, "working"> | null {
  if (!HELD_BY_ESPN.includes(status) || access === null || access === "working") return null;
  return access;
}
