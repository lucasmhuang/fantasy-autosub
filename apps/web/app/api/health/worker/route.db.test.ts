import { recordWorkerHeartbeat } from "@injurysub/db";
import { describe, expect } from "vitest";
import { createWebDatabaseConnection } from "../../../../lib/server/db";
import { webDbTest } from "../../../../lib/server/test-support";
import { GET } from "./route";

const secondsAgo = (seconds: number) => new Date(Date.now() - seconds * 1000);

describe("GET /api/health/worker", () => {
  webDbTest("answers 200 while the worker's newest beat is fresh", async ({ database }) => {
    const beatAt = secondsAgo(30);
    await recordWorkerHeartbeat(database.connection.db, {
      workerId: "worker-a",
      startedAt: secondsAgo(600),
      beatAt,
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      service: "worker",
      lastBeatAt: beatAt.toISOString(),
    });
  });

  webDbTest(
    "answers 503 once the newest beat is 3 minutes old, or before any",
    async ({ database }) => {
      expect((await GET()).status).toBe(503);

      const beatAt = secondsAgo(181);
      await recordWorkerHeartbeat(database.connection.db, {
        workerId: "worker-a",
        startedAt: secondsAgo(600),
        beatAt,
      });
      const response = await GET();

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        ok: false,
        service: "worker",
        lastBeatAt: beatAt.toISOString(),
      });
    }
  );

  // Public: the body says only that the check failed. The log names the failure, never the query.
  webDbTest(
    "answers 503 when the database can't be read, logging the failure by its code",
    async ({ webLog }) => {
      globalThis.__injurysubWebDb = createWebDatabaseConnection(
        `postgres://postgres:postgres@${process.env.PGHOST}:1/injurysub`
      );

      const response = await GET();

      const body = await response.text();
      expect(response.status).toBe(503);
      expect(JSON.parse(body)).toEqual({ ok: false, service: "worker", lastBeatAt: null });
      expect(webLog.events()).toEqual([
        expect.objectContaining({ event: "web.health.worker_unread", reason: "ECONNREFUSED" }),
      ]);
      expect(webLog.lines.join("\n")).not.toContain("worker_heartbeats");
    }
  );
});
