import { randomUUID } from "node:crypto";
import { createLogger } from "@injurysub/config";
import { emailOutbox, enqueueEmail } from "@injurysub/db";
import { createEmailClient } from "@injurysub/email";
import { afterEach, beforeEach, describe, expect, vi } from "vitest";
import { sendPendingEmails } from "./outbox";
import { dbTest } from "./test-support";

const start = new Date("2026-11-05T20:00:00.000Z");
const minutesAfterStart = (minutes: number) => new Date(start.getTime() + minutes * 60_000);

// Resend is faked at its HTTP boundary, so the real SDK runs. Each answer is used once, in order;
// every request's Idempotency-Key and body are kept.
let answers: { status: number; body: unknown }[] = [];
let sentKeys: (string | null)[] = [];
let sentBodies: Record<string, unknown>[] = [];

beforeEach(() => {
  answers = [];
  sentKeys = [];
  sentBodies = [];
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    sentKeys.push(new Headers(init?.headers).get("idempotency-key"));
    sentBodies.push(JSON.parse(String(init?.body)));
    const answer = answers.shift() ?? { status: 200, body: { id: "email-1" } };
    return Response.json(answer.body, { status: answer.status });
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const email = createEmailClient({
  mode: "resend",
  fromAddress: "requests@mail.injurysub.example",
  resendApiKey: "re_invented_key",
});
const unavailable = {
  status: 503,
  body: { name: "internal_server_error", message: "Down.", statusCode: 503 },
};

describe("sendPendingEmails", () => {
  dbTest(
    "sends a queued email once under its dedupe key, and marks it sent",
    async ({ database }) => {
      const { db } = database.connection;
      const emailId = randomUUID();
      await enqueueEmail(db, {
        emailId,
        dedupeKey: "request-1:1",
        toAddress: "commissioner@example.test",
        subject: "Team 5 needs you",
        body: "Body",
        createdAt: start,
      });
      const logger = createLogger("worker", "debug");

      await sendPendingEmails({ db, email, logger, now: start });
      await sendPendingEmails({ db, email, logger, now: minutesAfterStart(20) });

      expect(sentKeys).toEqual(["request-1:1"]);
      const [row] = await db.select().from(emailOutbox);
      expect(row?.sentAt).toEqual(start);
    }
  );

  // RS-EMAIL-6: the HTML part is built when the email is queued and stored with it.
  dbTest("sends a queued email's HTML part beside its text", async ({ database }) => {
    const { db } = database.connection;
    await enqueueEmail(db, { ...queued("request-5:1"), html: "<p>Body</p>" });
    const logger = createLogger("worker", "debug");

    await sendPendingEmails({ db, email, logger, now: start });

    expect(sentBodies).toEqual([expect.objectContaining({ text: "Body", html: "<p>Body</p>" })]);
  });

  // FM-EMAIL-1: a row an older version queued has no HTML part, and still goes out.
  dbTest("sends a queued email without an HTML part as text alone", async ({ database }) => {
    const { db } = database.connection;
    await enqueueEmail(db, queued("request-6:1"));
    const logger = createLogger("worker", "debug");

    await sendPendingEmails({ db, email, logger, now: start });

    expect(sentBodies).toHaveLength(1);
    expect(sentBodies[0]).toMatchObject({ text: "Body" });
    expect(sentBodies[0]).not.toHaveProperty("html");
  });

  dbTest("marks a refused email failed at once, never sending it again", async ({ database }) => {
    const { db } = database.connection;
    await enqueueEmail(db, queued("request-2:1"));
    answers = [
      { status: 422, body: { name: "validation_error", message: "Bad.", statusCode: 422 } },
    ];
    const logger = createLogger("worker", "debug");

    await sendPendingEmails({ db, email, logger, now: start });
    await sendPendingEmails({ db, email, logger, now: minutesAfterStart(20) });

    expect(sentKeys).toHaveLength(1);
    const [row] = await db.select().from(emailOutbox);
    expect([row?.failedAt, row?.failureCode]).toEqual([start, "send_rejected"]);
  });

  dbTest(
    "tries an unavailable provider again once the claim lapses, under the same key",
    async ({ database }) => {
      const { db } = database.connection;
      await enqueueEmail(db, queued("request-3:1"));
      answers = [unavailable];
      const logger = createLogger("worker", "debug");

      await sendPendingEmails({ db, email, logger, now: start });
      await sendPendingEmails({ db, email, logger, now: minutesAfterStart(5) });
      await sendPendingEmails({ db, email, logger, now: minutesAfterStart(11) });

      expect(sentKeys).toEqual(["request-3:1", "request-3:1"]);
      const [row] = await db.select().from(emailOutbox);
      expect([row?.sentAt, row?.failedAt]).toEqual([minutesAfterStart(11), null]);
    }
  );

  dbTest(
    "gives up after three unavailable attempts, keeping the last failure's code",
    async ({ database }) => {
      const { db } = database.connection;
      await enqueueEmail(db, queued("request-4:1"));
      answers = [unavailable, unavailable, unavailable];
      const logger = createLogger("worker", "debug");

      for (const minutes of [0, 11, 22, 33]) {
        await sendPendingEmails({ db, email, logger, now: minutesAfterStart(minutes) });
      }

      expect(sentKeys).toHaveLength(3);
      const [row] = await db.select().from(emailOutbox);
      expect([row?.failedAt, row?.failureCode]).toEqual([
        minutesAfterStart(22),
        "send_unavailable",
      ]);
    }
  );
});

function queued(dedupeKey: string) {
  return {
    emailId: randomUUID(),
    dedupeKey,
    toAddress: "commissioner@example.test",
    subject: "Team 5 needs you",
    body: "Body",
    createdAt: start,
  };
}
