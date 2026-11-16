import {
  createDatabaseConnection,
  type DatabaseClient,
  type DatabaseConnection,
  describeFailure,
  readMigrationState,
} from "@injurysub/db";
import { parse as parseConnectionString } from "pg-connection-string";
import { SeedError } from "./errors";

// The checks a script run against DATABASE_URL makes before it reads or writes anything, shared by
// the account seed and the practice reset. Each failure is a SeedError with a safe reason.

// localhost, 127.0.0.0/8 and ::1 are this machine.
const LOOPBACK_HOST = /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/;
const PLAIN_HOST = /^([A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])$/;
const PLAIN_DATABASE = /^[A-Za-z0-9._-]+$/;
// pg takes these from the query over the URL's own host and port (pg-connection-string 2.12.0
// index.js:41 and :54-63).
const TARGET_PARAMETERS = ["host", "hostaddr", "port"];

// A script that names its target (the seed, the practice reset) needs a URL that says truthfully
// where it connects, and naming it must print no credential: the host, port and database must be plain parts of the URL. pg would take
// a host or port from the query instead, and an unencoded "/" or "@" in the password shifts the
// parts, putting some of the password where the host or the database should be.
export function requireSupportedUrl(databaseUrl: string): URL {
  const url = new URL(databaseUrl);
  if (TARGET_PARAMETERS.some((name) => url.searchParams.has(name))) {
    throw new SeedError(
      "database_url_unsupported",
      "The database URL names its target in its query",
      "target_in_query"
    );
  }
  if (plainTarget(url) === undefined) {
    throw new SeedError(
      "database_url_unsupported",
      "The database URL's host, port or database isn't plain",
      "not_plain"
    );
  }
  return url;
}

// Even a dry run reads from the database (the seed reads the real addresses), so one off this
// machine must say how to encrypt, and not say "don't".
export function requireEncryptionSetting(url: URL) {
  if (LOOPBACK_HOST.test(url.hostname)) return;
  if (pgUsesTls(url)) return;
  if (url.searchParams.has("sslmode") || url.searchParams.has("ssl")) {
    throw new SeedError(
      "tls_disabled",
      "A database that isn't on this machine can't be reached unencrypted",
      "encryption_off"
    );
  }
  throw new SeedError(
    "tls_unspecified",
    "A database that isn't on this machine needs an encryption setting",
    "no_sslmode"
  );
}

// Decided from pg's own reading of the URL, which takes the last of a repeated setting and reads
// an empty one as unset. Its "ssl=false" is the truthy string "false"; that counts as off here,
// since it's what the URL's author meant.
function pgUsesTls(url: URL): boolean {
  const { ssl } = parseConnectionString(url.href);
  return ssl === true || ssl === "true" || (typeof ssl === "object" && ssl !== null);
}

// pg also reports a lost connection as an error event: on the pool for an idle client, and on the
// client itself while a query holds it, since pg-pool takes its own listener off then. Unheard,
// the event crashes the process. The loss also reaches the script as the failed query's error,
// whose cause chain names it, so the listeners have nothing more to do.
export function openConnection(options: {
  databaseUrl: string;
  applicationName: string;
  connectionTimeoutMs?: number;
  queryTimeoutMs?: number;
}): DatabaseConnection {
  const connection = createDatabaseConnection({
    connectionString: options.databaseUrl,
    applicationName: options.applicationName,
    maxConnections: 1,
    connectionTimeoutMs: options.connectionTimeoutMs ?? 5_000,
    queryTimeoutMs: options.queryTimeoutMs ?? 30_000,
    keepAlive: true,
  });
  connection.pool.on("error", ignoreLostConnection);
  connection.pool.on("connect", (client) => {
    client.on("error", ignoreLostConnection);
  });
  return connection;
}

function ignoreLostConnection(): void {}

export async function requireReachable(connection: DatabaseConnection) {
  try {
    await connection.check();
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    const reason = describeFailure(error);
    throw new SeedError("database_unreachable", "The database can't be reached", reason);
  }
}

// Refused before anything is read: no app schema, migrations still to run, or a database a
// newer checkout migrated.
export async function requireCurrentSchema(db: DatabaseClient) {
  const { hasAccountsTable, latestApplied, latestKnown } = await readMigrationState(db);
  if (!hasAccountsTable) {
    throw new SeedError(
      "schema_missing",
      "The database lacks the app's schema",
      "no_accounts_table"
    );
  }
  if (latestApplied === null || latestApplied < latestKnown) {
    throw new SeedError("schema_outdated", "The database is behind the app's migrations", "behind");
  }
  if (latestApplied > latestKnown) {
    throw new SeedError("schema_ahead", "The database is ahead of the app's migrations", "ahead");
  }
}

// host:port/database, never the user or the password; undefined for a URL that doesn't parse, or
// whose target isn't plain, since its parts could then hold some of the password.
export function targetOf(databaseUrl: string): string | undefined {
  return URL.canParse(databaseUrl) ? plainTarget(new URL(databaseUrl)) : undefined;
}

function plainTarget(url: URL): string | undefined {
  const database = url.pathname.slice(1);
  if (TARGET_PARAMETERS.some((name) => url.searchParams.has(name))) return undefined;
  if (!PLAIN_HOST.test(url.hostname) || !PLAIN_DATABASE.test(database)) return undefined;
  return `${url.hostname}:${url.port || "5432"}/${database}`;
}
