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
    // An operator configures a host from this file, so it names every setting the host needs.
    expect(example.SIGN_IN_CODE_TTL_MINUTES).toBe("10");
    expect(example.DEPLOYMENT_MODE).toBe("");
    expect(example.ESPN_SEND_MODE).toBe("never");
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

// Invented credentials: enough for the schema to accept live ESPN.
const liveEspnSettings = { ESPN_MODE: "live", ESPN_S2: "s2", ESPN_SWID: "{swid}", LEAGUE_ID: "1" };

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

  it("requires a scenario for scripted ESPN, naming ESPN_SCENARIO", () => {
    const scripted = serverEnvSchema.safeParse({ ESPN_MODE: "scripted", ESPN_SCENARIO: "" });

    expect(scripted.error?.issues.map((issue) => issue.path)).toEqual([["ESPN_SCENARIO"]]);
    expect(
      serverEnvSchema.safeParse({ ESPN_MODE: "scripted", ESPN_SCENARIO: "one-out-starter" }).success
    ).toBe(true);
  });

  it("needs no ESPN credentials in none mode", () => {
    expect(serverEnvSchema.safeParse({ ESPN_MODE: "none" }).success).toBe(true);
  });

  it("sends nothing to ESPN unless ESPN_SEND_MODE says live", () => {
    expect(loadServerEnv({}).ESPN_SEND_MODE).toBe("never");
    expect(loadServerEnv({ ...liveEspnSettings, ESPN_SEND_MODE: "live" }).ESPN_SEND_MODE).toBe(
      "live"
    );
  });

  it.each([
    { ESPN_MODE: "stub" },
    { ESPN_MODE: "scripted", ESPN_SCENARIO: "one-out-starter" },
    { ESPN_MODE: "none" },
  ])("refuses ESPN_SEND_MODE=live unless ESPN is read live, naming it ($ESPN_MODE)", (espn) => {
    const result = serverEnvSchema.safeParse({ ...espn, ESPN_SEND_MODE: "live" });

    expect(result.error?.issues.map((issue) => issue.path)).toEqual([["ESPN_SEND_MODE"]]);
    expect(serverEnvSchema.safeParse({ ...espn, ESPN_SEND_MODE: "never" }).success).toBe(true);
  });

  it("defaults the worker link and the request expiry", () => {
    expect(loadServerEnv({})).toMatchObject({
      WORKER_INTERNAL_URL: "http://127.0.0.1:3001",
      REQUEST_EXPIRY_HOURS: 12,
    });
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

// Settings a hosted deployment accepts. Invented values only.
const hostedSettings = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://app@db.internal.example:5432/injurysub?sslmode=no-verify",
  APP_BASE_URL: "https://injurysub.example",
  SESSION_SECRET: "s".repeat(48),
  EMAIL_DELIVERY_MODE: "resend",
  RESEND_API_KEY: "re_invented_key",
  EMAIL_FROM_ADDRESS: "signin@mail.injurysub.example",
  WORKER_INTERNAL_TOKEN: "t".repeat(64),
};

function settingsWithout(key: keyof typeof hostedSettings) {
  const { [key]: _omitted, ...rest } = hostedSettings;
  return rest;
}

describe("serverEnvSchema on a hosted deployment", () => {
  it("accepts real settings under NODE_ENV=production", () => {
    expect(serverEnvSchema.safeParse(hostedSettings).error?.issues).toBeUndefined();
  });

  it.each([
    ["SESSION_SECRET", "dev-session-secret-change-me"],
    ["SESSION_SECRET", "s".repeat(31)],
    ["APP_BASE_URL", "http://injurysub.example"],
    ["APP_BASE_URL", "https://localhost:3000"],
    ["APP_BASE_URL", "https://127.0.0.1"],
    ["APP_BASE_URL", "https://[::1]:3000"],
    ["EMAIL_DELIVERY_MODE", "console"],
    ["EMAIL_FROM_ADDRESS", "noreply@example.com"],
    ["DATABASE_URL", "postgres://postgres:postgres@localhost:5432/injurysub"],
    ["DATABASE_URL", "postgres://postgres:postgres@localhost:5432/injurysub?sslmode=disable"],
    ["DATABASE_URL", "postgres://app@127.0.0.1:5432/injurysub"],
    ["DATABASE_URL", "not a url"],
    ["APP_BASE_URL", "https://localhost."],
    ["WORKER_INTERNAL_TOKEN", "dev-worker-internal-token-change-me"],
    ["WORKER_INTERNAL_TOKEN", "t".repeat(31)],
  ] as const)("refuses %s=%s, naming the setting", (key, value) => {
    const result = serverEnvSchema.safeParse({ ...hostedSettings, [key]: value });

    expect(result.error?.issues.map((issue) => issue.path)).toEqual([[key]]);
  });

  it.each([
    "SESSION_SECRET",
    "APP_BASE_URL",
    "EMAIL_DELIVERY_MODE",
    "EMAIL_FROM_ADDRESS",
    "DATABASE_URL",
    "WORKER_INTERNAL_TOKEN",
  ] as const)("refuses an unset %s, naming it", (key) => {
    const result = serverEnvSchema.safeParse(settingsWithout(key));

    expect(result.error?.issues.map((issue) => issue.path)).toEqual([[key]]);
  });

  it("never puts a setting's value in its message", () => {
    const result = serverEnvSchema.safeParse({
      ...hostedSettings,
      SESSION_SECRET: "distinctive-secret-value",
      APP_BASE_URL: "http://distinctive-host.example",
    });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).not.toContain("distinctive-secret");
    expect(JSON.stringify(result.error?.issues)).not.toContain("distinctive-host");
  });

  it.each([
    "development",
    "test",
  ])("leaves development defaults alone under NODE_ENV=%s", (nodeEnv) => {
    expect(serverEnvSchema.safeParse({ NODE_ENV: nodeEnv }).error?.issues).toBeUndefined();
  });

  it("leaves development defaults alone under NODE_ENV=production with DEPLOYMENT_MODE=local", () => {
    const result = serverEnvSchema.safeParse({ NODE_ENV: "production", DEPLOYMENT_MODE: "local" });

    expect(result.error?.issues).toBeUndefined();
  });

  it("refuses development defaults with DEPLOYMENT_MODE=hosted, whatever NODE_ENV says", () => {
    const result = serverEnvSchema.safeParse({
      NODE_ENV: "development",
      DEPLOYMENT_MODE: "hosted",
    });

    expect(result.success).toBe(false);
  });

  it.each([
    {},
    { DEPLOYMENT_MODE: "" },
  ])("treats NODE_ENV=production as hosted when DEPLOYMENT_MODE isn't set (%j)", (mode) => {
    const result = serverEnvSchema.safeParse({ NODE_ENV: "production", ...mode });

    expect(result.error?.issues.map((issue) => issue.path)).toEqual([
      ["APP_BASE_URL"],
      ["SESSION_SECRET"],
      ["EMAIL_DELIVERY_MODE"],
      ["EMAIL_FROM_ADDRESS"],
      ["DATABASE_URL"],
      ["WORKER_INTERNAL_TOKEN"],
    ]);
  });
});
