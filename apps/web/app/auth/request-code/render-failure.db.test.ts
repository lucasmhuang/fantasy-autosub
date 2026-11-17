import { findNewestSignInCode, signInCodes } from "@injurysub/db";
import { buildSignInCodeEmail } from "@injurysub/email";
import { afterEach, beforeEach, describe, expect, vi } from "vitest";
import { insertInventedUser, webDbTest } from "../../../lib/server/test-support";
import { POST } from "./route";

// The sign-in email's builder is the real one, wrapped so one test can make its render fail: a
// failure no input can cause, which only a defect in the email's code would.
vi.mock("@injurysub/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@injurysub/email")>();
  return { ...actual, buildSignInCodeEmail: vi.fn(actual.buildSignInCodeEmail) };
});

const appOrigin = "http://localhost:3000";

function requestCode(email: string) {
  return POST(
    new Request("http://0.0.0.0:8080/auth/request-code", {
      method: "POST",
      headers: { origin: appOrigin },
      body: new URLSearchParams({ email }),
    })
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", async () => Response.json({ id: "msg_1" }, { status: 200 }));
  vi.stubEnv("EMAIL_DELIVERY_MODE", "resend");
  vi.stubEnv("RESEND_API_KEY", "re_invented_key");
  vi.stubEnv("SESSION_SECRET", "a-test-session-secret-for-codes-0001");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("POST /auth/request-code when the email can't be built", () => {
  webDbTest(
    "keeps the code already sent as the one that works, and fails the request",
    async ({ database }) => {
      const { db } = database.connection;
      const userId = await insertInventedUser(db);
      const email = `person-${userId}@example.test`;
      await requestCode(email);
      const [first] = await db.select().from(signInCodes);

      vi.mocked(buildSignInCodeEmail).mockRejectedValueOnce(new Error("render failed"));
      await expect(requestCode(email)).rejects.toThrow("render failed");

      const codes = (await db.select().from(signInCodes)).sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
      );
      expect(codes).toHaveLength(2);
      expect(codes[1]?.sendFailedAt).not.toBeNull();
      expect((await findNewestSignInCode(db, userId))?.codeId).toBe(first?.codeId);
    }
  );
});
