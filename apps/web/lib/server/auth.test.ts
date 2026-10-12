import { describe, expect, it } from "vitest";
import { getSafePostLoginPath } from "./auth";

describe("getSafePostLoginPath", () => {
  it("keeps managers out of commissioner pages", () => {
    expect(getSafePostLoginPath({ redirectPath: "/commish/requests", role: "manager" })).toBe(
      "/app"
    );
    expect(getSafePostLoginPath({ redirectPath: "/commish", role: "manager" })).toBe("/app");
    expect(getSafePostLoginPath({ redirectPath: "/commishioner", role: "manager" })).toBe("/app");
  });

  it("sends commissioners from the manager home to their requests page", () => {
    expect(getSafePostLoginPath({ redirectPath: "/app", role: "commissioner" })).toBe(
      "/commish/requests"
    );
    expect(getSafePostLoginPath({ redirectPath: "/commish/requests", role: "commissioner" })).toBe(
      "/commish/requests"
    );
  });

  it("falls back to each role's default page without a destination", () => {
    expect(getSafePostLoginPath({ role: "manager" })).toBe("/app");
    expect(getSafePostLoginPath({ redirectPath: null, role: "commissioner" })).toBe(
      "/commish/requests"
    );
  });

  it("keeps query strings on in-app destinations", () => {
    expect(getSafePostLoginPath({ redirectPath: "/app?week=3", role: "manager" })).toBe(
      "/app?week=3"
    );
    expect(getSafePostLoginPath({ redirectPath: "/app?week=3", role: "commissioner" })).toBe(
      "/app?week=3"
    );
  });
});
