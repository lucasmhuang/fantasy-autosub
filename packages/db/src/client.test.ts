import { describe, expect, it } from "vitest";
import { createDatabaseConnection } from "./client";
import { DatabaseError } from "./errors";

// The setup file's dead host (PGHOST) refuses at once; nothing listens on port 1 there.
const deadDatabaseUrl = `postgres://postgres:postgres@${process.env.PGHOST}:1/injurysub`;

describe("createDatabaseConnection", () => {
  it("rejects a transaction that can't open a connection with connect_failed, keeping pg's error", async () => {
    const connection = createDatabaseConnection({ connectionString: deadDatabaseUrl });
    try {
      const failure = await connection
        .transaction(async () => "never reached")
        .catch((error) => error);

      expect(failure).toBeInstanceOf(DatabaseError);
      expect(failure).toMatchObject({ name: "DatabaseError", code: "connect_failed" });
      expect(failure.cause).toMatchObject({ code: "ECONNREFUSED" });
    } finally {
      await connection.close();
    }
  });
});
