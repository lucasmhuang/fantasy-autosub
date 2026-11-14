import { describe, expect, it } from "vitest";
import { isWorkerDown } from "./heartbeat";

const now = new Date("2026-11-15T18:00:00.000Z");
const secondsAgo = (seconds: number) => new Date(now.getTime() - seconds * 1000);

describe("isWorkerDown", () => {
  it("counts a worker whose newest beat is 3 minutes old as down, and a 30-second one as up", () => {
    expect(isWorkerDown(secondsAgo(30), now)).toBe(false);
    expect(isWorkerDown(secondsAgo(179), now)).toBe(false);
    expect(isWorkerDown(secondsAgo(180), now)).toBe(true);
  });

  it("counts a worker that never beat as down", () => {
    expect(isWorkerDown(null, now)).toBe(true);
  });
});
