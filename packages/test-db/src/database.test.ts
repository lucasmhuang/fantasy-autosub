import { describe, expect, inject, it } from "vitest";
import { resolveAdminUrl } from "./database";
import { TestDatabaseError } from "./errors";

function failureOf(call: () => unknown): TestDatabaseError {
  try {
    call();
  } catch (error) {
    if (error instanceof TestDatabaseError) return error;
    throw error;
  }
  throw new Error("expected the call to fail");
}

describe("resolveAdminUrl", () => {
  it("refuses a test outside the database test files, naming the file convention", () => {
    const error = failureOf(() => resolveAdminUrl(undefined));

    expect(error.code).toBe("not_a_database_test");
    expect(error.message).toContain("*.db.test.ts");
  });
});

describe("a unit test", () => {
  it("gets no test database URL, since only the database project's setup provides one", () => {
    expect(inject("testDatabaseAdminUrl")).toBeUndefined();
  });
});
