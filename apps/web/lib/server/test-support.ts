import { randomUUID } from "node:crypto";
import { createLogger } from "@injurysub/config";
import {
  createDatabaseConnection,
  createRequest,
  createSession,
  type DatabaseExecutor,
  type NewSubRequest,
  sessions,
  userAccounts,
} from "@injurysub/db";
import { hashSessionToken } from "@injurysub/domain";
import {
  EspnError,
  type EspnErrorCode,
  type InternalReadClient,
  type TeamWeekRead,
} from "@injurysub/espn";
import { createDbTest } from "@injurysub/test-db";
import { inject, test, vi } from "vitest";

// What the web logger wrote during one test: its JSON lines exactly as they'd reach the host's
// logs, and the same lines parsed.
export type WebLog = { lines: string[]; events: () => Record<string, unknown>[] };

function connectForTests(url: string) {
  return createDatabaseConnection({
    connectionString: url,
    applicationName: "injurysub-test",
    maxConnections: 4,
  });
}

// The `test` for apps/web's *.db.test.ts files. Each test gets its own migrated database, which
// the web app's connection singleton returns; a fresh email client, built from the test's env; and
// the real web logger, whose lines are captured instead of printed; and no ESPN client, so a test
// that reads ESPN puts its own in __injurysubWebEspn. All four are cleared after.
// Test code only; nothing outside the tests imports it.
export const webDbTest = createDbTest({ test, inject }, connectForTests).extend<{ webLog: WebLog }>(
  {
    webLog: [
      // Vitest's fixture callback, named so React's hook lint doesn't take it for `use`.
      async ({ database }, runTest) => {
        const lines: string[] = [];
        const capture = (line: unknown) => {
          lines.push(String(line));
        };
        const consoleSpies = [
          vi.spyOn(console, "log").mockImplementation(capture),
          vi.spyOn(console, "warn").mockImplementation(capture),
          vi.spyOn(console, "error").mockImplementation(capture),
        ];
        globalThis.__injurysubWebDb = database.connection;
        globalThis.__injurysubWebEmailClient = undefined;
        globalThis.__injurysubWebLogger = createLogger("web", "debug");
        globalThis.__injurysubWebEspn = undefined;
        try {
          await runTest({
            lines,
            events: (): Record<string, unknown>[] => lines.map((line) => JSON.parse(line)),
          });
        } finally {
          globalThis.__injurysubWebDb = undefined;
          globalThis.__injurysubWebEmailClient = undefined;
          globalThis.__injurysubWebLogger = undefined;
          globalThis.__injurysubWebEspn = undefined;
          for (const spy of consoleSpies) spy.mockRestore();
        }
      },
      { auto: true },
    ],
  }
);

// Invented people only.
export async function insertInventedUser(
  db: DatabaseExecutor,
  {
    isActive = true,
    role = "manager",
    teamId = null,
  }: { isActive?: boolean; role?: "manager" | "commissioner"; teamId?: number | null } = {}
) {
  const userId = randomUUID();
  await db.insert(userAccounts).values({
    userId,
    email: `person-${userId}@example.test`,
    teamId,
    displayName: "Invented Person",
    role,
    isActive,
  });
  return userId;
}

// A session stored the way the web app stores one, by the hash of its token; returns the token.
// By default it was made 30 days before `now`, last seen an hour before, and expires 10 days after.
export async function insertSession(
  db: DatabaseExecutor,
  userId: string,
  now: Date,
  overrides: Partial<typeof sessions.$inferInsert> = {}
) {
  const hour = 3_600_000;
  const token = `token-${randomUUID()}`;
  await createSession(db, {
    sessionId: hashSessionToken(token),
    userId,
    createdAt: new Date(now.getTime() - 30 * 24 * hour),
    lastSeenAt: new Date(now.getTime() - hour),
    expiresAt: new Date(now.getTime() + 10 * 24 * hour),
    ...overrides,
  });
  return token;
}

// apps/web can't import drizzle's operators, and each test's database holds only its own rows.
export async function readSession(db: DatabaseExecutor, token: string) {
  const rows = await db.select().from(sessions);
  return rows.find((row) => row.sessionId === hashSessionToken(token)) ?? null;
}

export type TeamWeekChange = (read: TeamWeekRead) => TeamWeekRead;

// Gives the web this ESPN client for the test, each team week passed through `change` (a test
// edits a scripted read this way). The scripted client itself is built in the test file: this
// file is scanned by the no-ESPN-client guard, which skips only test files.
export function setWebEspn(
  espn: InternalReadClient,
  change: TeamWeekChange = (read) => read
): void {
  globalThis.__injurysubWebEspn = {
    getTeamWeek: async (teamId) => change(await espn.getTeamWeek(teamId)),
    checkLeagueRules: () => espn.checkLeagueRules(),
  };
}

// Every web ESPN read fails with this code, as the worker's proxy would report it.
export function setRefusingWebEspn(code: EspnErrorCode): void {
  const refuse = async () => Promise.reject(new EspnError(code, "invented refusal"));
  globalThis.__injurysubWebEspn = { getTeamWeek: refuse, checkLeagueRules: refuse };
}

// An invented request for team 1 in the scenarios' matchup 2 (Damian Lillard out, Jeremiah Fears
// in), filed by an invented person unless `requestedBy` is given; its request snapshot may carry
// a projection, and its filed event a payload (an on-behalf attestation, say). Returns its id.
export async function insertInventedRequest(
  db: DatabaseExecutor,
  overrides: Partial<NewSubRequest> = {},
  snapshotPayload: Record<string, unknown> = {},
  filedPayload: Record<string, unknown> = {}
): Promise<string> {
  const request = inventedRequest(
    overrides.requestedBy ?? (await insertInventedUser(db)),
    overrides
  );
  const now = request.createdAt ?? new Date();
  await createRequest(db, {
    request,
    snapshot: { snapshotId: randomUUID(), espnDay: 8, takenAt: now, payload: snapshotPayload },
    event: {
      eventId: randomUUID(),
      actorType: "manager",
      actorUserId: request.requestedBy,
      eventType: "request_filed",
      payload: filedPayload,
      createdAt: now,
    },
    email: null,
  });
  return request.requestId;
}

function inventedRequest(requestedBy: string, overrides: Partial<NewSubRequest>): NewSubRequest {
  const now = overrides.createdAt ?? new Date("2026-10-28T01:00:00.000Z");
  return {
    requestId: randomUUID(),
    kind: "substitution",
    teamId: 1,
    season: 2027,
    matchupPeriodId: 2,
    matchupId: 7,
    requestedBy,
    idempotencyKey: randomUUID(),
    injuredPlayerId: 6606,
    injuredName: "Damian Lillard",
    injuredSlot: "G",
    replacementPlayerId: 5144091,
    replacementName: "Jeremiah Fears",
    requestMoment: now,
    filedAt: now,
    requestDay: 8,
    designationAtRequest: "OUT",
    replacementPointsAtRequestTenths: 0,
    snapshotSource: "observed",
    status: "needs_review",
    reviewReason: "automation_off",
    executionModeAtRequest: "approval_required",
    projectedAdjustmentTenths: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
