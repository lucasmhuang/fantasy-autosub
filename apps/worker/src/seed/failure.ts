import type { SeedErrorCode } from "./errors";

export type FailureCode = SeedErrorCode | "database_failure";

// What to do about each failure: a fixed sentence, with no data in it.
export const FAILURE_HINTS: Record<FailureCode, string> = {
  path_not_absolute: "Name the accounts file by its absolute path.",
  tls_unspecified:
    "Add sslmode to the database URL: a database that isn't on this machine needs an encryption setting.",
  file_unreadable: "Check that the accounts file exists and that it can be read.",
  file_invalid: "Fix the rows the problems name, then run the seed again.",
  database_unreachable:
    "Check the database URL, that the database is running, and that it takes connections from here.",
  schema_missing: "Run pnpm db:migrate against this database first.",
  schema_outdated: "Run pnpm db:migrate against this database first.",
  schema_ahead: "Update your checkout first: a newer one migrated this database.",
  database_failure: "Nothing was changed. Check the reason, then run the seed again.",
};

export const UNKNOWN_OUTCOME_HINT =
  "The connection failed while committing, so whether the changes were saved is unknown. Running the seed again is safe.";

// Node errnos (ECONNREFUSED), SQLSTATEs (23505, 28P01) and TLS codes are all of this shape.
const CODE_SHAPE = /^[A-Z0-9_]{2,64}$/;

// pg's fixed messages for failures that carry no code: pg-pool 3.13.0 index.js:276, and pg 8.20
// lib/client.js:150 and :180.
const FIXED_MESSAGES = new Map([
  ["Connection terminated due to connection timeout", "timeout"],
  ["timeout expired", "timeout"],
  ["Connection terminated unexpectedly", "connection_lost"],
]);

// A safe reason for a failure: the first code along its cause chain, else the label of one of pg's
// fixed messages, else "unknown". It never returns any of the errors' own text, which can hold a
// query's parameters, an address, or a database URL.
export function describeFailure(error: unknown): string {
  const chain = causeChain(error);
  const code = chain.map(codeOf).find((candidate) => candidate !== undefined);
  if (code !== undefined) return code;
  const label = chain.map((link) => FIXED_MESSAGES.get(link.message)).find(Boolean);
  return label ?? "unknown";
}

function causeChain(error: unknown): Error[] {
  const chain: Error[] = [];
  let current = error;
  // The cap also ends a chain that loops back on itself.
  while (current instanceof Error && chain.length < 10) {
    chain.push(current);
    current = current.cause;
  }
  return chain;
}

function codeOf(error: Error): string | undefined {
  const code: unknown = Reflect.get(error, "code");
  return typeof code === "string" && CODE_SHAPE.test(code) ? code : undefined;
}
