import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { setTimeout as sleepFor } from "node:timers/promises";
import { AppError, type LogContext, type Logger } from "@injurysub/config";
import {
  acquireWriteLease,
  countPracticeReset,
  type DatabaseConnection,
  describeFailure,
  type PracticeResetCounts,
  type PracticeResetStanding,
  readPracticeResetStanding,
  releaseWriteLease,
  renewWriteLease,
  resetPracticeDatabase,
  type WriteLease,
} from "@injurysub/db";
import {
  openConnection,
  requireCurrentSchema,
  requireEncryptionSetting,
  requireReachable,
  requireSupportedUrl,
  targetOf,
} from "./seed/database";
import { SeedError, type SeedErrorCode } from "./seed/errors";

export type PracticeResetOptions = {
  apply: boolean;
  databaseUrl: string;
  logger: Logger;
  now: Date;
  // How long an apply waits for the ESPN-write lease while a pass holds it.
  leaseWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
  connectionTimeoutMs?: number;
  queryTimeoutMs?: number;
};

type PracticeResetCode = "not_practice" | "lease_busy";
type Resettable = Exclude<PracticeResetStanding, "real">;

// The practice reset refusing to go on. The message names the step, never a value.
export class PracticeResetError extends AppError {
  override readonly name = "PracticeResetError";
  readonly code: PracticeResetCode;

  constructor(code: PracticeResetCode, message: string) {
    super(message);
    this.code = code;
  }
}

// An executor pass gives the lease back once its request is done, well inside this.
const DEFAULT_LEASE_WAIT_MS = 60_000;
const LEASE_RETRY_MS = 1_000;
const LEASE_TTL_SECONDS = 60;

type FailureCode =
  | Exclude<SeedErrorCode, "path_not_absolute" | "file_unreadable" | "file_invalid">
  | PracticeResetCode
  | "database_failure";

// What to do about each failure: a fixed sentence, with no data in it.
const FAILURE_HINTS: Record<FailureCode, string> = {
  database_url_unsupported:
    "Put the host, port and database in the URL itself, not its query, and percent-encode any special character in the user or the password.",
  tls_unspecified:
    "Add sslmode to the database URL: a database that isn't on this machine needs an encryption setting.",
  tls_disabled: "Use sslmode=no-verify (or require) for a database that isn't on this machine.",
  database_unreachable:
    "Check the database URL, that the database is running, and that it takes connections from here.",
  schema_missing: "Run pnpm db:migrate against this database first.",
  schema_outdated: "Run pnpm db:migrate against this database first.",
  schema_ahead: "Update your checkout first: a newer one migrated this database.",
  not_practice:
    "This database isn't a practice one and its writes reached ESPN: the reset never empties it.",
  lease_busy: "A worker is sending to ESPN: run the reset again once its request is done.",
  database_failure: "Check the reason, then run the reset again: running it again is safe.",
};

// Empties a practice database's requests, so staging's walk can start again: every request with
// its ESPN writes, events, snapshots and outbox emails; a misuse alert matched to one is kept,
// unmatched. A dry run unless `apply`, naming the target and what it would remove. It runs only on
// a practice database, or on one whose writes were only ever recorded (staging's before its first
// practice walk), which it marks practice; a database whose writes reached ESPN is refused. An
// apply is one transaction under the ESPN-write lease, waiting while a pass holds it. A practice
// worker rebuilds its copy of ESPN on its next pass. Nothing it prints names a credential.
export async function runPracticeReset(
  options: PracticeResetOptions
): Promise<{ exitCode: 0 | 1 }> {
  try {
    await resetPractice(options);
    return { exitCode: 0 };
  } catch (error) {
    const target = targetOf(options.databaseUrl);
    options.logger.error("practice.reset.failed", undefined, {
      ...failureLine(error),
      ...(target === undefined ? {} : { target }),
    });
    return { exitCode: 1 };
  }
}

async function resetPractice(options: PracticeResetOptions): Promise<void> {
  requireEncryptionSetting(requireSupportedUrl(options.databaseUrl));
  const connection = openConnection({ ...options, applicationName: "injurysub-practice-reset" });
  try {
    await requireReachable(connection);
    await requireCurrentSchema(connection.db);
    const standing = requireResettable(await readPracticeResetStanding(connection.db));
    const result = options.apply
      ? await applyReset(connection, options)
      : { standing, counts: await countPracticeReset(connection.db) };
    options.logger.info("practice.reset.summary", {
      target: targetOf(options.databaseUrl) ?? "",
      mode: options.apply ? "applied" : "dry run",
      standing: result.standing,
      marked: options.apply && result.standing === "markable",
      ...result.counts,
    });
  } finally {
    await connection.close();
  }
}

function requireResettable(standing: PracticeResetStanding): Resettable {
  if (standing !== "real") return standing;
  throw new PracticeResetError(
    "not_practice",
    "The database isn't a practice one, and its writes reached ESPN"
  );
}

// Under the lease, so no pass is sending while the requests go; the standing is read again inside
// the transaction, since a write may have been sent since the first read.
async function applyReset(
  connection: DatabaseConnection,
  options: PracticeResetOptions
): Promise<{ standing: Resettable; counts: PracticeResetCounts }> {
  const lease = await waitForLease(connection, options);
  try {
    return await connection.transaction(async (tx) => {
      const held = await renewWriteLease(tx, { ...lease, ttlSeconds: LEASE_TTL_SECONDS });
      if (!held) throw new PracticeResetError("lease_busy", "A worker took the ESPN-write lease");
      const standing = requireResettable(await readPracticeResetStanding(tx));
      const counts = await resetPracticeDatabase(tx, {
        now: options.now,
        mark: standing === "markable",
      });
      return { standing, counts };
    });
  } finally {
    await releaseWriteLease(connection.db, lease);
  }
}

async function waitForLease(
  connection: DatabaseConnection,
  options: PracticeResetOptions
): Promise<WriteLease> {
  const sleep = options.sleep ?? ((ms: number) => sleepFor(ms));
  const holder = `practice-reset-${randomUUID()}`;
  const deadline = performance.now() + (options.leaseWaitMs ?? DEFAULT_LEASE_WAIT_MS);
  for (;;) {
    const lease = await acquireWriteLease(connection.db, {
      holder,
      ttlSeconds: LEASE_TTL_SECONDS,
    });
    if (lease !== null) return lease;
    if (performance.now() >= deadline) {
      throw new PracticeResetError("lease_busy", "A worker kept the ESPN-write lease");
    }
    await sleep(LEASE_RETRY_MS);
  }
}

// The failure line's code, reason and hint. Never the error itself: drizzle's message carries the
// query's parameters.
function failureLine(error: unknown): LogContext {
  if (error instanceof PracticeResetError) {
    return { code: error.code, reason: error.code, hint: FAILURE_HINTS[error.code] };
  }
  if (error instanceof SeedError && isFailureCode(error.code)) {
    return { code: error.code, reason: error.reason, hint: FAILURE_HINTS[error.code] };
  }
  const reason = describeFailure(error);
  return { code: "database_failure", reason, hint: FAILURE_HINTS.database_failure };
}

function isFailureCode(code: string): code is FailureCode {
  return code in FAILURE_HINTS;
}
