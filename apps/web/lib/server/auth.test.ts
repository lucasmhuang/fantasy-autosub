import { describe, expect, it } from "vitest";
import {
  COMMISSIONER_ONLY,
  commissionerAccess,
  getSafePostLoginPath,
  signInLocation,
} from "./auth";

const manager = { role: "manager", teamId: 5 } as const;
const commissioner = { role: "commissioner", teamId: 1 } as const;
const teamlessCommissioner = { role: "commissioner", teamId: null } as const;

describe("getSafePostLoginPath", () => {
  it("keeps managers out of commissioner pages, saying it is commissioner-only", () => {
    expect(getSafePostLoginPath({ redirectPath: "/commish/requests", ...manager })).toBe(
      COMMISSIONER_ONLY
    );
    expect(getSafePostLoginPath({ redirectPath: "/commish", ...manager })).toBe(COMMISSIONER_ONLY);
    expect(getSafePostLoginPath({ redirectPath: "/commishioner", ...manager })).toBe(
      COMMISSIONER_ONLY
    );
  });

  it("keeps managers out of commissioner pages reached through dot segments", () => {
    for (const redirectPath of [
      "/app/../commish/requests",
      "/app/%2e%2e/commish/requests",
      "/./commish/requests",
      "/app/./../commish/settings",
    ]) {
      expect(getSafePostLoginPath({ redirectPath, ...manager })).toBe(COMMISSIONER_ONLY);
    }
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

describe("commissionerAccess", () => {
  it("lets only a commissioner into the commissioner pages, and sends no one else in", () => {
    expect(commissionerAccess({ user: { role: "commissioner" } })).toBe("allowed");
    expect(commissionerAccess({ user: { role: "manager" } })).toBe("not_commissioner");
    expect(commissionerAccess(null)).toBe("sign_in");
  });
});

// IF-SIGNIN-4, KF1: a page sends a signed-out browser to sign in with its own path and query, so
// the code brings it straight back.
describe("signInLocation", () => {
  it("carries the page's path and query to sign-in", () => {
    expect(signInLocation("/app/requests/new", { injured: "1", replacement: "2" })).toBe(
      `/login?redirect=${encodeURIComponent("/app/requests/new?injured=1&replacement=2")}`
    );
  });

  it("leaves out what the address didn't carry", () => {
    expect(signInLocation("/app", { starter: undefined })).toBe("/login?redirect=%2Fapp");
  });
});
