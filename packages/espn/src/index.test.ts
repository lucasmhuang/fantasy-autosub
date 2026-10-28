import { describe, expect, it } from "vitest";
import * as espn from "./index";

// Code outside this package imports only from this entry. The worker's error handling needs
// EspnError and its code from it to tell failed reads apart: credentials to refresh, or ESPN
// unavailable. So the entry exports the class the reads throw, and the type of its code.
describe("the package entry", () => {
  it("exports the error the reads throw, and the type of its code", async () => {
    const failure: unknown = await espn
      .createEspnClient({ mode: "stub" })
      .getLineup(999)
      .then(
        () => undefined,
        (error: unknown) => error
      );

    expect(espn.EspnError).toBeTypeOf("function");
    expect(failure).toBeInstanceOf(espn.EspnError);
    const code: espn.EspnErrorCode | undefined =
      failure instanceof espn.EspnError ? failure.code : undefined;
    expect(code).toBe("team_not_found");
  });
});
