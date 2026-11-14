import { getLatestWorkerHeartbeat } from "@injurysub/db";
import { describe, expect } from "vitest";
import { heartbeatTask } from "./heartbeat";
import { dbTest } from "./test-support";

const startedAt = new Date("2026-11-15T18:00:00.000Z");
const firstBeat = new Date("2026-11-15T18:00:15.000Z");
const secondBeat = new Date("2026-11-15T18:00:30.000Z");

describe("heartbeatTask", () => {
  dbTest("records this worker's beat at each run, at the clock's time", async ({ database }) => {
    const beats = [firstBeat, secondBeat];
    const task = heartbeatTask({
      db: database.connection.db,
      workerId: "worker-a",
      startedAt,
      clock: () => beats.shift() ?? secondBeat,
    });

    await task.run();
    expect(await getLatestWorkerHeartbeat(database.connection.db)).toEqual({
      workerId: "worker-a",
      startedAt,
      beatAt: firstBeat,
    });
    await task.run();

    expect(task.name).toBe("heartbeat");
    expect(await getLatestWorkerHeartbeat(database.connection.db)).toEqual({
      workerId: "worker-a",
      startedAt,
      beatAt: secondBeat,
    });
  });
});
