import { describe, expect, it } from "vitest";
import { getSafePostLoginPath } from "./auth";

const manager = { role: "manager", teamId: 5 } as const;
const commissioner = { role: "commissioner", teamId: 1 } as const;
const teamlessCommissioner = { role: "commissioner", teamId: null } as const;

describe("getSafePostLoginPath", () => {
  it("keeps managers out of commissioner pages", () => {
    expect(getSafePostLoginPath({ redirectPath: "/commish/requests", ...manager })).toBe("/app");
    expect(getSafePostLoginPath({ redirectPath: "/commish", ...manager })).toBe("/app");
    expect(getSafePostLoginPath({ redirectPath: "/commishioner", ...manager })).toBe("/app");
  });

  it("lets a commissioner with a team reach their team page and the commissioner pages", () => {
    expect(getSafePostLoginPath({ redirectPath: "/app", ...commissioner })).toBe("/app");
    expect(getSafePostLoginPath({ redirectPath: "/commish/requests", ...commissioner })).toBe(
      "/commish/requests"
    );
  });

  it("sends a commissioner without a team from the team page to the requests page", () => {
    expect(getSafePostLoginPath({ redirectPath: "/app", ...teamlessCommissioner })).toBe(
      "/commish/requests"
    );
  });

  it("falls back to each account's default page without a destination", () => {
    expect(getSafePostLoginPath({ ...manager })).toBe("/app");
    expect(getSafePostLoginPath({ redirectPath: null, ...commissioner })).toBe("/app");
    expect(getSafePostLoginPath({ redirectPath: null, ...teamlessCommissioner })).toBe(
      "/commish/requests"
    );
  });

  it("keeps query strings on in-app destinations", () => {
    expect(getSafePostLoginPath({ redirectPath: "/app?week=3", ...manager })).toBe("/app?week=3");
    expect(getSafePostLoginPath({ redirectPath: "/app?week=3", ...commissioner })).toBe(
      "/app?week=3"
    );
  });
});
