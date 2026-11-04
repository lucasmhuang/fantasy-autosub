import { randomUUID } from "node:crypto";
import { type DatabaseExecutor, insertSignInCode, signInCodes } from "@injurysub/db";
import { createEmailClient } from "@injurysub/email";
import { afterEach, beforeEach, describe, expect, vi } from "vitest";
import { createWebDatabaseConnection } from "../../../lib/server/db";
import { insertInventedUser, webDbTest } from "../../../lib/server/test-support";
import { POST } from "./route";

const appOrigin = "http://localhost:3000";

// Resend is faked at its HTTP boundary, so the real SDK and email client run, and each email's
// request body is captured: that's how a test reads the code it was sent.
const providerFetch =
  vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();

function respondFromProvider(status: number, body: unknown) {
  providerFetch.mockImplementation(async () =>
    Response.json(body, { status, headers: { "content-type": "application/json" } })
  );
}

function sentEmails(): { to: string; text: string }[] {
  return providerFetch.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
}

function codeIn(text: string): string {
  const code = /\b\d{6}\b/.exec(text)?.[0];
  if (code === undefined) throw new Error("the email holds no 6-digit code");
  return code;
}

// Behind the host's proxy, the request's own URL is the server's internal address.
function requestCode(fields: Record<string, string>, origin: string | null = appOrigin) {
  return POST(
    new Request("http://0.0.0.0:8080/auth/request-code", {
      method: "POST",
      headers: origin === null ? {} : { origin },
      body: new URLSearchParams(fields),
    })
  );
}

// The login page reads these parameters back, by these names and values.
function loginParams(response: Response): [string, string][] {
  const location = new URL(response.headers.get("location") ?? "");
  expect(response.status).toBe(303);
  expect(location.origin + location.pathname).toBe(`${appOrigin}/login`);
  return [...location.searchParams.entries()];
}

async function insertManager(db: DatabaseExecutor, options: { isActive?: boolean } = {}) {
  const userId = await insertInventedUser(db, options);
  return { userId, email: `person-${userId}@example.test` };
}

beforeEach(() => {
  providerFetch.mockReset();
  respondFromProvider(200, { id: "msg_1" });
  vi.stubGlobal("fetch", providerFetch);
  vi.stubEnv("EMAIL_DELIVERY_MODE", "resend");
  vi.stubEnv("RESEND_API_KEY", "re_invented_key");
  vi.stubEnv("SESSION_SECRET", "a-test-session-secret-for-codes-0001");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("POST /auth/request-code", () => {
  webDbTest(
    "sends one code to the account's stored address, stores only its hash, and moves to the code step",
    async ({ database }) => {
      const { db } = database.connection;
      const manager = await insertManager(db);

      const response = await requestCode({ email: `  ${manager.email.toUpperCase()} ` });

      expect(loginParams(response)).toEqual([
        ["step", "code"],
        ["status", "code_sent"],
        ["email", manager.email],
        ["redirect", "/app"],
      ]);
      const emails = sentEmails();
      expect(emails).toHaveLength(1);
      expect(emails[0]?.to).toBe(manager.email);
      expect(emails[0]?.text).not.toContain("/auth/");
      const code = codeIn(emails[0]?.text ?? "");
      const rows = await db.select().from(signInCodes);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.userId).toBe(manager.userId);
      expect(rows[0]?.codeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(rows[0]?.codeHash).not.toContain(code);
    }
  );

  webDbTest.for([
    ["an address with no account", false],
    ["a disabled account's address", true],
  ] as const)(
    "answers unknown_email for %s, sending and storing nothing",
    async ([, exists], { database }) => {
      const { db } = database.connection;
      const email = exists
        ? (await insertManager(db, { isActive: false })).email
        : "nobody@example.test";

      const response = await requestCode({ email });

      expect(loginParams(response)).toEqual([
        ["status", "unknown_email"],
        ["email", email],
        ["redirect", "/app"],
      ]);
      expect(sentEmails()).toHaveLength(0);
      expect(await db.select().from(signInCodes)).toHaveLength(0);
    }
  );

  webDbTest("answers invalid_email for a malformed address", async ({ database }) => {
    const response = await requestCode({ email: "not-an-address" });

    expect(loginParams(response)).toEqual([
      ["status", "invalid_email"],
      ["redirect", "/app"],
    ]);
    expect(sentEmails()).toHaveLength(0);
    expect(await database.connection.db.select().from(signInCodes)).toHaveLength(0);
  });

  webDbTest(
    "refuses a fourth code within 15 minutes, saying how long to wait, then allows one later",
    async ({ database }) => {
      const { connection } = database;
      const manager = await insertManager(connection.db);
      for (let request = 0; request < 3; request += 1) {
        await requestCode({ email: manager.email });
      }

      const refused = await requestCode({ email: manager.email });

      expect(loginParams(refused)).toEqual([
        ["step", "code"],
        ["status", "too_many_codes"],
        ["email", manager.email],
        ["redirect", "/app"],
        ["retry", "15"],
      ]);
      expect(sentEmails()).toHaveLength(3);
      expect(await connection.db.select().from(signInCodes)).toHaveLength(3);

      await connection.pool.query(
        "update sign_in_codes set created_at = created_at - interval '16 minutes'"
      );
      const allowed = await requestCode({ email: manager.email });

      expect(new URL(allowed.headers.get("location") ?? "").searchParams.get("status")).toBe(
        "code_sent"
      );
    }
  );

  // Requests for one address are counted one at a time, under a lock on the account's row.
  webDbTest("sends only three codes when six requests arrive at once", async ({ database }) => {
    const { db } = database.connection;
    const manager = await insertManager(db);

    await Promise.all(Array.from({ length: 6 }, () => requestCode({ email: manager.email })));

    expect(await db.select().from(signInCodes)).toHaveLength(3);
    expect(sentEmails()).toHaveLength(3);
  });

  webDbTest("refuses an eleventh code in a day", async ({ database }) => {
    const { db } = database.connection;
    const manager = await insertManager(db);
    const now = Date.now();
    for (let hoursAgo = 1; hoursAgo <= 10; hoursAgo += 1) {
      await insertSignInCode(db, {
        codeId: randomUUID(),
        userId: manager.userId,
        codeHash: "an-older-code",
        redirectPath: "/app",
        createdAt: new Date(now - hoursAgo * 3_600_000),
        expiresAt: new Date(now - hoursAgo * 3_600_000 + 600_000),
      });
    }

    const response = await requestCode({ email: manager.email });

    // The oldest of the ten turns a day old in 14 hours.
    expect(loginParams(response)).toContainEqual(["retry", String(14 * 60)]);
    expect(sentEmails()).toHaveLength(0);
  });

  webDbTest(
    "records and logs the failed email when the provider refuses it",
    async ({ database, webLog }) => {
      const { db } = database.connection;
      const manager = await insertManager(db);
      respondFromProvider(403, {
        name: "validation_error",
        message: "The domain is not verified.",
        statusCode: 403,
      });

      const response = await requestCode({ email: manager.email });

      expect(loginParams(response)).toEqual([
        ["status", "send_failed"],
        ["email", manager.email],
        ["redirect", "/app"],
      ]);
      const [row] = await db.select().from(signInCodes);
      expect(row?.sendFailedAt).not.toBeNull();
      expect(webLog.events()).toMatchObject([
        {
          event: "web.auth.sign_in_code_send_failed",
          userId: manager.userId,
          error: { code: "send_rejected" },
        },
      ]);
      const code = codeIn(sentEmails()[0]?.text ?? "");
      for (const line of webLog.lines) {
        expect(line).not.toContain(code);
        expect(line).not.toContain(manager.email);
      }
    }
  );

  webDbTest(
    "logs a failed email even when recording the failure fails, then answers try-again",
    async ({ database, webLog }) => {
      const { connection } = database;
      const manager = await insertManager(connection.db);
      await connection.pool.query(`
        create function probe_refuse_update() returns trigger language plpgsql as $$
          begin raise exception 'probe: updates refused'; end $$;
        create trigger probe_refuse_update before update on sign_in_codes
          for each row execute function probe_refuse_update();
      `);
      respondFromProvider(403, { name: "validation_error", message: "Refused.", statusCode: 403 });

      const response = await requestCode({ email: manager.email });

      expect(loginParams(response)).toContainEqual(["status", "unavailable"]);
      expect(webLog.events()).toContainEqual(
        expect.objectContaining({
          event: "web.auth.sign_in_code_send_failed",
          userId: manager.userId,
        })
      );
      expect(webLog.events()).toContainEqual(
        expect.objectContaining({
          event: "web.auth.database_failed",
          flow: "request_code",
          reason: "P0001",
        })
      );
    }
  );

  webDbTest("counts a failed email toward the limit", async ({ database }) => {
    const manager = await insertManager(database.connection.db);
    await requestCode({ email: manager.email });
    await requestCode({ email: manager.email });
    respondFromProvider(403, { name: "validation_error", message: "Refused.", statusCode: 403 });
    await requestCode({ email: manager.email });
    respondFromProvider(200, { id: "msg_2" });

    const response = await requestCode({ email: manager.email });

    expect(loginParams(response)).toContainEqual(["status", "too_many_codes"]);
  });

  webDbTest(
    "answers send_failed in time when the provider doesn't answer",
    async ({ database }) => {
      const manager = await insertManager(database.connection.db);
      providerFetch.mockImplementation(() => new Promise<Response>(() => {}));
      globalThis.__injurysubWebEmailClient = createEmailClient({
        mode: "resend",
        fromAddress: "signin@mail.injurysub.example",
        resendApiKey: "re_invented_key",
        sendTimeoutMs: 100,
      });
      const started = performance.now();

      const response = await requestCode({ email: manager.email });

      expect(loginParams(response)).toContainEqual(["status", "send_failed"]);
      expect(performance.now() - started).toBeLessThan(2_000);
    }
  );

  webDbTest.for([["https://evil.example"], [null]] as const)(
    "refuses a request sent with Origin %s, storing and sending nothing",
    async ([origin], { database }) => {
      const manager = await insertManager(database.connection.db);

      const response = await requestCode({ email: manager.email }, origin);

      expect(response.status).toBe(403);
      expect(sentEmails()).toHaveLength(0);
      expect(await database.connection.db.select().from(signInCodes)).toHaveLength(0);
    }
  );

  webDbTest(
    "stores an internal destination with the code, and the default for an off-site one",
    async ({ database }) => {
      const { db } = database.connection;
      const manager = await insertManager(db);

      const internal = await requestCode({
        email: manager.email,
        redirectPath: "/commish/requests",
      });
      const offSite = await requestCode({ email: manager.email, redirectPath: "/\\evil.example" });

      expect(loginParams(internal)).toContainEqual(["redirect", "/commish/requests"]);
      expect(loginParams(offSite)).toContainEqual(["redirect", "/app"]);
      const stored = (await db.select().from(signInCodes)).map((row) => row.redirectPath).sort();
      expect(stored).toEqual(["/app", "/commish/requests"]);
    }
  );

  // Called directly, a route that throws would reach Next's error printer, which prints drizzle's
  // message: the query and its parameters, the typed address among them.
  webDbTest(
    "sends the address back with a try-again message when the database is down, logging no address",
    async ({ webLog }) => {
      const unreachable = createWebDatabaseConnection(
        "postgres://postgres:postgres@127.0.0.2:1/injurysub"
      );
      globalThis.__injurysubWebDb = unreachable;
      try {
        const response = await requestCode({ email: "  Invented.Person@Example.test " });

        expect(loginParams(response)).toEqual([
          ["status", "unavailable"],
          ["email", "invented.person@example.test"],
          ["redirect", "/app"],
        ]);
        expect(sentEmails()).toHaveLength(0);
        expect(webLog.events()).toEqual([
          expect.objectContaining({
            event: "web.auth.database_failed",
            flow: "request_code",
            reason: "ECONNREFUSED",
          }),
        ]);
        expect(webLog.lines.join("\n").toLowerCase()).not.toContain("invented.person@example.test");
      } finally {
        await unreachable.close();
      }
    }
  );

  // Only a failed query is answered with "try again". A transaction that can't open a connection
  // fails before any query, with pg's own error (it names no person), and reaches Next like any
  // other unexpected error.
  webDbTest(
    "lets a transaction that can't open a connection reach Next, logging nothing",
    async ({ database, webLog }) => {
      const manager = await insertManager(database.connection.db);
      const unreachable = createWebDatabaseConnection(
        "postgres://postgres:postgres@127.0.0.2:1/injurysub"
      );
      globalThis.__injurysubWebDb = {
        ...database.connection,
        transaction: unreachable.transaction,
      };
      try {
        await expect(requestCode({ email: manager.email })).rejects.toThrow(/ECONNREFUSED/);
        expect(sentEmails()).toHaveLength(0);
        expect(webLog.events()).toEqual([]);
      } finally {
        await unreachable.close();
      }
    }
  );
});
