import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { TestProject } from "vitest/node";
import { urlOfDatabase, withClient } from "./connection";
import {
  ensureDocker,
  failStart,
  isProcessAlive,
  removeAfterFailure,
  removeTestPostgres,
  runDocker,
  startTestPostgres,
  sweepStaleTestPostgres,
  waitUntilAccepting,
} from "./container";
import { TestDatabaseError } from "./errors";

// Each database test clones this database, which the app's migrations build once per run.
export const TEMPLATE_DATABASE = "injurysub_template";

declare module "vitest" {
  // An interface, since only an interface merges with Vitest's own declaration.
  export interface ProvidedContext {
    testDatabaseAdminUrl: string;
  }
}

// The database project's global setup, given the folder of the app's migrations. It starts this
// run's test server, builds the template, gives the tests the server's admin URL, and returns the
// teardown that removes the server. A failure past the start removes the server before it's thrown.
export function databaseGlobalSetup({ migrationsFolder }: { migrationsFolder: string }) {
  return async (project: Pick<TestProject, "provide">): Promise<() => void> => {
    ensureDocker(runDocker);
    sweepStaleTestPostgres(runDocker, isProcessAlive);
    const server = startTestPostgres(runDocker, { pid: process.pid });
    try {
      await waitUntilAccepting(server.adminUrl, 30_000);
    } catch (error) {
      if (!(error instanceof TestDatabaseError)) throw withRemoval(server.id, error);
      throw failStart(runDocker, server.id, error);
    }
    try {
      await buildTemplate(server.adminUrl, migrationsFolder);
    } catch (error) {
      throw withRemoval(server.id, error);
    }
    project.provide("testDatabaseAdminUrl", server.adminUrl);
    return () => removeTestPostgres(runDocker, server.id);
  };
}

async function buildTemplate(adminUrl: string, migrationsFolder: string): Promise<void> {
  await withClient(adminUrl, (client) => client.query(`create database ${TEMPLATE_DATABASE}`), {
    timeoutMs: 30_000,
  });
  await withClient(
    urlOfDatabase(adminUrl, TEMPLATE_DATABASE),
    (client) => migrate(drizzle(client), { migrationsFolder }),
    { timeoutMs: 60_000 }
  );
}

// Removes the server, and gives back the failure to throw: as it was, or, when the server won't
// go either, an error that names both.
function withRemoval(id: string, failure: unknown): unknown {
  const leftover = removeAfterFailure(runDocker, id);
  if (leftover === "") return failure;
  const message = failure instanceof Error ? failure.message : String(failure);
  return new TestDatabaseError(
    "container_failed",
    `${message}${leftover}`,
    failure instanceof Error ? { cause: failure } : {}
  );
}
