import { describe, expect, it, vi } from "vitest";
import { EspnError } from "../read/errors";
import { checkScenarioCredentials } from "./load";

// A scenario file naming a refusal that isn't an ESPN error code (a hand edit, say).
vi.mock("../../scenarios/credentials-rejected.json", () => ({
  default: { refuseWith: "credentials_expired", responses: {} },
}));

describe("a scenario file", () => {
  it("is refused as unreadable when its refusal isn't an ESPN error code", async () => {
    const failure = await checkScenarioCredentials("credentials-rejected").catch(
      (error: unknown) => error
    );

    expect(failure).toBeInstanceOf(EspnError);
    expect((failure as EspnError).code).toBe("unrecognized_response");
  });
});
