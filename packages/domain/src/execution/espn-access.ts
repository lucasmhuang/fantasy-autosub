// Whether the worker can read ESPN, as its last check found: working, the cookie refused, or
// ESPN unreachable or answering in a way the reads can't use (the stored code says which).
export const espnAccessStates = ["working", "credentials_rejected", "unreachable"] as const;
export type EspnAccessState = (typeof espnAccessStates)[number];

// The access state an ESPN read leaves: no error code means it worked.
export function espnAccessStateFor(errorCode: string | null): EspnAccessState {
  if (errorCode === null) return "working";
  return errorCode === "credentials_rejected" ? "credentials_rejected" : "unreachable";
}
