import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { describe, expect, it } from "vitest";
import { loadServerEnv, serverEnvSchema } from "./env";

describe("loadServerEnv", () => {
  it("loads the shipped example settings file", () => {
    const example = parseEnv(
      readFileSync(new URL("../../../.env.example", import.meta.url), "utf8")
    );
    const env = loadServerEnv(example);

    expect(env.EMAIL_DELIVERY_MODE).toBe("console");
    expect(env.LEAGUE_ID).toBe(undefined);
    expect(env.RESEND_API_KEY).toBe(undefined);
  });

  // A default and its example value move together, as SEASON_YEAR must each October.
  it("gives the same settings from the shipped example as from the defaults", () => {
    const example = parseEnv(
      readFileSync(new URL("../../../.env.example", import.meta.url), "utf8")
    );

    expect(loadServerEnv(example)).toEqual(loadServerEnv({}));
  });

  it("treats blank optional settings as unset", () => {
    const env = loadServerEnv({ RESEND_API_KEY: "", ESPN_S2: "", ESPN_SWID: "", LEAGUE_ID: "" });

    expect(env.RESEND_API_KEY).toBe(undefined);
    expect(env.ESPN_S2).toBe(undefined);
    expect(env.ESPN_SWID).toBe(undefined);
    expect(env.LEAGUE_ID).toBe(undefined);
  });
});

describe("serverEnvSchema", () => {
  it("rejects a blank setting that has a default, naming the setting", () => {
    const keys = [
      "EMAIL_DELIVERY_MODE",
      "APP_BASE_URL",
      "DATABASE_URL",
      "SESSION_SECRET",
      "SEASON_YEAR",
    ];
    for (const key of keys) {
      const result = serverEnvSchema.safeParse({ [key]: "" });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual([key]);
    }
  });

  it("still requires credentials for live ESPN and resend email", () => {
    const liveEspn = serverEnvSchema.safeParse({
      ESPN_MODE: "live",
      ESPN_S2: "",
      ESPN_SWID: "{swid}",
      LEAGUE_ID: "1",
    });
    const resendEmail = serverEnvSchema.safeParse({
      EMAIL_DELIVERY_MODE: "resend",
      RESEND_API_KEY: "",
    });

    expect(liveEspn.error?.issues[0]?.path).toEqual(["ESPN_S2"]);
    expect(resendEmail.error?.issues[0]?.path).toEqual(["RESEND_API_KEY"]);
  });

  it.each(["ESPN_SWID", "LEAGUE_ID"])("requires %s for live ESPN, naming it", (key) => {
    const liveEspn = serverEnvSchema.safeParse({
      ESPN_MODE: "live",
      ESPN_S2: "s2",
      ESPN_SWID: "{swid}",
      LEAGUE_ID: "1",
      [key]: "",
    });

    expect(liveEspn.error?.issues.map((issue) => issue.path)).toEqual([[key]]);
  });
});
