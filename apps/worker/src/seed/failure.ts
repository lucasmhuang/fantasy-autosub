import type { SeedErrorCode } from "./errors";

export type FailureCode = SeedErrorCode | "database_failure";

// What to do about each failure: a fixed sentence, with no data in it.
export const FAILURE_HINTS: Record<FailureCode, string> = {
  path_not_absolute: "Name the accounts file by its absolute path.",
  database_url_unsupported:
    "Put the host, port and database in the URL itself, not its query, and percent-encode any special character in the user or the password.",
  tls_unspecified:
    "Add sslmode to the database URL: a database that isn't on this machine needs an encryption setting.",
  tls_disabled:
    "Use sslmode=no-verify (or require) for a database that isn't on this machine: the seed doesn't send the league's accounts unencrypted.",
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
