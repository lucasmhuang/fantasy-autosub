import { type DatabaseExecutor, sessions, signInCodes } from "@injurysub/db";
import { afterEach, beforeEach, describe, expect, vi } from "vitest";
import { insertInventedUser, webDbTest } from "../../../lib/server/test-support";
import { POST as requestCodeRoute } from "../request-code/route";
import { POST } from "./route";

const appOrigin = "http://localhost:3000";

// Resend is faked at its HTTP boundary; each test reads the code it was sent from the captured
// request body, as the person reads it from the email.
const providerFetch =
  vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();

function codesSentTo(email: string): string[] {
  const sent: { to: string; text: string }[] = providerFetch.mock.calls.map(([, init]) =>
    JSON.parse(String(init?.body))
  );
  return sent
    .filter((message) => message.to === email)
    .map((message) => /\b\d{6}\b/.exec(message.text)?.[0] ?? "");
}

function otherThan(code: string): string {
  return String((Number(code) + 1) % 1_000_000).padStart(6, "0");
}

function post(route: (request: Request) => Promise<Response>, path: string) {
  return (fields: Record<string, string>, origin: string | null = appOrigin) =>
    route(
      new Request(`http://0.0.0.0:8080${path}`, {
        method: "POST",
        headers: origin === null ? {} : { origin, "user-agent": "InventedBrowser/1.0" },
        body: new URLSearchParams(fields),
      })
    );
}

const requestCode = post(requestCodeRoute, "/auth/request-code");
const verifyCode = post(POST, "/auth/verify-code");

// Requests a code for the address, through the real route, and returns the code emailed.
async function sendCode(email: string, redirectPath?: string): Promise<string> {
  await requestCode(redirectPath === undefined ? { email } : { email, redirectPath });
  const code = codesSentTo(email).at(-1);
  if (!code) throw new Error("no code was emailed");
  return code;
}

function location(response: Response) {
  return new URL(response.headers.get("location") ?? "");
}

function loginParams(response: Response): [string, string][] {
  expect(response.status).toBe(303);
  expect(location(response).pathname).toBe("/login");
  return [...location(response).searchParams.entries()];
}

async function insertPerson(
  db: DatabaseExecutor,
  role: "manager" | "commissioner" = "manager"
): Promise<{ userId: string; email: string }> {
  const userId = await insertInventedUser(db, { role });
  return { userId, email: `person-${userId}@example.test` };
}

beforeEach(() => {
  providerFetch.mockReset();
  providerFetch.mockImplementation(async () =>
    Response.json({ id: "msg_1" }, { headers: { "content-type": "application/json" } })
  );
  vi.stubGlobal("fetch", providerFetch);
  vi.stubEnv("EMAIL_DELIVERY_MODE", "resend");
  vi.stubEnv("RESEND_API_KEY", "re_invented_key");
  vi.stubEnv("SESSION_SECRET", "a-test-session-secret-for-codes-0001");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("POST /auth/verify-code", () => {
  webDbTest(
    "signs this browser in with the right code, storing the session by hash",
    async ({ database }) => {
      const { db } = database.connection;
      const manager = await insertPerson(db);
      const code = await sendCode(manager.email);

      const response = await verifyCode({ email: manager.email, code });

      expect(response.status).toBe(303);
      expect(location(response).href).toBe(`${appOrigin}/app`);
      const cookie = response.headers.get("set-cookie") ?? "";
      expect(cookie).toMatch(/^injurysub_session=[A-Za-z0-9_-]{32};/);
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toMatch(/SameSite=lax/i);
      const stored = await db.select().from(sessions);
      expect(stored).toHaveLength(1);
      expect(stored[0]?.userId).toBe(manager.userId);
      expect(stored[0]?.sessionId).toMatch(/^[0-9a-f]{64}$/);
      expect(stored[0]?.userAgent).toBe("InventedBrowser/1.0");
    }
  );

  webDbTest("refuses the same code a second time", async ({ database }) => {
    const manager = await insertPerson(database.connection.db);
    const code = await sendCode(manager.email);
    await verifyCode({ email: manager.email, code });

    const again = await verifyCode({ email: manager.email, code });

    expect(loginParams(again)).toEqual([
      ["step", "code"],
      ["status", "code_expired"],
      ["email", manager.email],
      ["redirect", "/app"],
    ]);
  });

  webDbTest("sends the commissioner to the requests page", async ({ database }) => {
    const commissioner = await insertPerson(database.connection.db, "commissioner");
    const code = await sendCode(commissioner.email);

    const response = await verifyCode({ email: commissioner.email, code });

    expect(location(response).href).toBe(`${appOrigin}/commish/requests`);
  });

  webDbTest("sends a manager who asked for a commissioner page to /app", async ({ database }) => {
    const manager = await insertPerson(database.connection.db);
    const code = await sendCode(manager.email, "/commish/requests");

    const response = await verifyCode({ email: manager.email, code });

    expect(location(response).href).toBe(`${appOrigin}/app`);
  });

  webDbTest(
    "counts down wrong entries, then signs in with the right code on the fifth try",
    async ({ database }) => {
      const manager = await insertPerson(database.connection.db);
      const code = await sendCode(manager.email);

      const triesLeft: (string | null)[] = [];
      for (let entry = 0; entry < 4; entry += 1) {
        const wrong = await verifyCode({ email: manager.email, code: otherThan(code) });
        expect(location(wrong).searchParams.get("status")).toBe("wrong_code");
        triesLeft.push(location(wrong).searchParams.get("tries"));
      }
      const right = await verifyCode({ email: manager.email, code });

      expect(triesLeft).toEqual(["4", "3", "2", "1"]);
      expect(location(right).href).toBe(`${appOrigin}/app`);
    }
  );

  webDbTest(
    "locks the code on the fifth wrong entry, so even the right code then fails",
    async ({ database, webLog }) => {
      const manager = await insertPerson(database.connection.db);
      const code = await sendCode(manager.email);
      for (let entry = 0; entry < 4; entry += 1) {
        await verifyCode({ email: manager.email, code: otherThan(code) });
      }

      const fifth = await verifyCode({ email: manager.email, code: otherThan(code) });
      const right = await verifyCode({ email: manager.email, code });

      expect(loginParams(fifth)).toEqual([
        ["step", "code"],
        ["status", "too_many_tries"],
        ["email", manager.email],
        ["redirect", "/app"],
      ]);
      expect(location(right).searchParams.get("status")).toBe("too_many_tries");
      expect(webLog.events()).toContainEqual(
        expect.objectContaining({ event: "web.auth.sign_in_code_locked", userId: manager.userId })
      );
    }
  );

  webDbTest(
    "spends exactly five tries when ten wrong entries arrive at once",
    async ({ database }) => {
      const { db } = database.connection;
      const manager = await insertPerson(db);
      const code = await sendCode(manager.email);

      await Promise.all(
        Array.from({ length: 10 }, () =>
          verifyCode({ email: manager.email, code: otherThan(code) })
        )
      );

      const [row] = await db.select().from(signInCodes);
      expect(row?.attempts).toBe(5);
    }
  );

  webDbTest("refuses an expired code", async ({ database }) => {
    const { connection } = database;
    const manager = await insertPerson(connection.db);
    const code = await sendCode(manager.email);
    await connection.pool.query(
      "update sign_in_codes set expires_at = now() - interval '1 second'"
    );

    const response = await verifyCode({ email: manager.email, code });

    expect(location(response).searchParams.get("status")).toBe("code_expired");
  });

  webDbTest(
    "takes only the newest code: an older one counts as a wrong try",
    async ({ database }) => {
      const manager = await insertPerson(database.connection.db);
      const first = await sendCode(manager.email);
      const second = await sendCode(manager.email);

      const withFirst = await verifyCode({ email: manager.email, code: first });
      const withSecond = await verifyCode({ email: manager.email, code: second });

      expect(location(withFirst).searchParams.get("status")).toBe("wrong_code");
      expect(location(withSecond).href).toBe(`${appOrigin}/app`);
    }
  );

  webDbTest(
    "keeps the earlier code working when a newer code's email fails to send",
    async ({ database }) => {
      const manager = await insertPerson(database.connection.db);
      const delivered = await sendCode(manager.email);
      providerFetch.mockImplementation(async () =>
        Response.json(
          { name: "validation_error", message: "Refused.", statusCode: 403 },
          { status: 403, headers: { "content-type": "application/json" } }
        )
      );
      await requestCode({ email: manager.email });

      const response = await verifyCode({ email: manager.email, code: delivered });

      expect(location(response).href).toBe(`${appOrigin}/app`);
    }
  );

  webDbTest("never signs one account in with another's code", async ({ database }) => {
    const { db } = database.connection;
    const owner = await insertPerson(db);
    const other = await insertPerson(db);
    const ownersCode = await sendCode(owner.email);
    await sendCode(other.email);

    const response = await verifyCode({ email: other.email, code: ownersCode });

    expect(location(response).searchParams.get("status")).toBe("wrong_code");
    expect(await db.select().from(sessions)).toHaveLength(0);
  });

  webDbTest("refuses a code for an account disabled since it was sent", async ({ database }) => {
    const { connection } = database;
    const manager = await insertPerson(connection.db);
    const code = await sendCode(manager.email);
    await connection.pool.query("update user_accounts set is_active = false");

    const response = await verifyCode({ email: manager.email, code });

    expect(loginParams(response)).toEqual([
      ["status", "unknown_email"],
      ["email", manager.email],
    ]);
    expect(await connection.db.select().from(sessions)).toHaveLength(0);
  });

  webDbTest("accepts a code typed with a space", async ({ database }) => {
    const manager = await insertPerson(database.connection.db);
    const code = await sendCode(manager.email);

    const response = await verifyCode({
      email: manager.email,
      code: `${code.slice(0, 3)} ${code.slice(3)}`,
    });

    expect(location(response).href).toBe(`${appOrigin}/app`);
  });

  webDbTest(
    "refuses a code that isn't six digits, without spending a try",
    async ({ database }) => {
      const { db } = database.connection;
      const manager = await insertPerson(db);
      await sendCode(manager.email);

      const response = await verifyCode({ email: manager.email, code: "abc" });

      expect(loginParams(response)).toEqual([
        ["step", "code"],
        ["status", "invalid_code"],
        ["email", manager.email],
      ]);
      expect((await db.select().from(signInCodes))[0]?.attempts).toBe(0);
    }
  );

  webDbTest(
    "refuses a code sent before SESSION_SECRET changed, as a wrong try",
    async ({ database }) => {
      const manager = await insertPerson(database.connection.db);
      const code = await sendCode(manager.email);
      vi.stubEnv("SESSION_SECRET", "a-rotated-session-secret-for-codes-02");

      const response = await verifyCode({ email: manager.email, code });

      expect(location(response).searchParams.get("status")).toBe("wrong_code");
    }
  );

  webDbTest.for([["https://evil.example"], [null]] as const)(
    "refuses a code sent with Origin %s, without spending a try",
    async ([origin], { database }) => {
      const { db } = database.connection;
      const manager = await insertPerson(db);
      const code = await sendCode(manager.email);

      const response = await verifyCode({ email: manager.email, code }, origin);

      expect(response.status).toBe(403);
      expect((await db.select().from(signInCodes))[0]?.attempts).toBe(0);
      expect(await db.select().from(sessions)).toHaveLength(0);
    }
  );

  webDbTest(
    "sends the person to /app when the code was requested with an off-site destination",
    async ({ database }) => {
      const manager = await insertPerson(database.connection.db);
      const code = await sendCode(manager.email, "/\\evil.example");

      const response = await verifyCode({ email: manager.email, code });

      expect(location(response).href).toBe(`${appOrigin}/app`);
    }
  );

  webDbTest("never logs the code", async ({ database, webLog }) => {
    const manager = await insertPerson(database.connection.db);
    const code = await sendCode(manager.email);
    for (let entry = 0; entry < 5; entry += 1) {
      await verifyCode({ email: manager.email, code: otherThan(code) });
    }
    await verifyCode({ email: manager.email, code });

    expect(webLog.lines.length).toBeGreaterThan(0);
    for (const line of webLog.lines) {
      expect(line).not.toContain(code);
    }
  });
});
