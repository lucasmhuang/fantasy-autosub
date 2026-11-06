import { loadServerEnv } from "@injurysub/config";
import { EspnError } from "@injurysub/espn";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkerEspnClient } from "./espn-client";
import { WorkerStartupError } from "./startup-error";

afterEach(() => {
  vi.unstubAllGlobals();
});

// Records every URL asked for, answering none.
function recordRequests(): string[] {
  const requested: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    requested.push(String(url));
    throw new Error("no request expected");
  });
  return requested;
}

async function rejectionOf(read: Promise<unknown>): Promise<unknown> {
  try {
    await read;
  } catch (error) {
    return error;
  }
  throw new Error("expected the read to fail");
}

describe("createWorkerEspnClient", () => {
  it("refuses every read without credentials in none mode, sending nothing", async () => {
    const requested = recordRequests();
    const client = createWorkerEspnClient(loadServerEnv({ ESPN_MODE: "none" }));

    expect(client.mode).toBe("none");
    expect(await rejectionOf(client.getTeamWeek(1))).toMatchObject({ code: "not_connected" });
    expect(requested).toEqual([]);
  });

  it("reads the named scenario in scripted mode, sending nothing", async () => {
    const requested = recordRequests();
    const client = createWorkerEspnClient(
      loadServerEnv({ ESPN_MODE: "scripted", ESPN_SCENARIO: "credentials-rejected" })
    );

    expect(client.mode).toBe("scripted");
    const failure = await rejectionOf(client.getTeamWeek(1));
    expect(failure).toBeInstanceOf(EspnError);
    expect(failure).toMatchObject({ code: "credentials_rejected" });
    expect(requested).toEqual([]);
  });

  it("refuses a scenario that doesn't exist, naming the setting and not the value", () => {
    const build = () =>
      createWorkerEspnClient(
        loadServerEnv({ ESPN_MODE: "scripted", ESPN_SCENARIO: "no-such-scenario" })
      );

    expect(build).toThrow(WorkerStartupError);
    expect(build).toThrow(/ESPN_SCENARIO/);
    expect(build).not.toThrow(/no-such-scenario/);
  });

  it("reads the committed recordings in stub mode", () => {
    expect(createWorkerEspnClient(loadServerEnv({})).mode).toBe("stub");
  });

  it("reads live ESPN in live mode", () => {
    const env = loadServerEnv({
      ESPN_MODE: "live",
      ESPN_S2: "s2",
      ESPN_SWID: "{swid}",
      LEAGUE_ID: "1",
    });

    expect(createWorkerEspnClient(env).mode).toBe("live");
  });
});
