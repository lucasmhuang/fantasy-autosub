import { describe, expect, it } from "vitest";
import { createDatabaseConnection } from "./client";
import { describeFailure, isDatabaseQueryError } from "./failure";

// 127.0.0.2 refuses at once; nothing listens there.
const deadDatabaseUrl = "postgres://postgres:postgres@127.0.0.2:1/injurysub";

// What a failed call against an unreachable database throws.
async function failureOf(
  call: (connection: ReturnType<typeof connectToDeadDatabase>) => Promise<unknown>
) {
  const connection = connectToDeadDatabase();
  try {
    await call(connection);
  } catch (error) {
    return error;
  } finally {
    await connection.close();
  }
  throw new Error("the call succeeded against a dead address");
}

function connectToDeadDatabase() {
  return createDatabaseConnection({
    connectionString: deadDatabaseUrl,
    connectionTimeoutMs: 2_000,
  });
}

// An error as Node and pg raise them: a message, and maybe a code and a cause.
function failure(message: string, fields: { code?: string; cause?: unknown } = {}): Error {
  const error = new Error(
    message,
    fields.cause === undefined ? undefined : { cause: fields.cause }
  );
  if (fields.code !== undefined) Object.assign(error, { code: fields.code });
  return error;
}

describe("describeFailure", () => {
  it("names a Node error by its code", () => {
    expect(
      describeFailure(failure("connect ECONNREFUSED 127.0.0.2:1", { code: "ECONNREFUSED" }))
    ).toBe("ECONNREFUSED");
  });

  it("names a Postgres error under drizzle's wrapper by its SQLSTATE, and none of its text", () => {
    const postgres = Object.assign(failure("duplicate key value violates unique constraint"), {
      code: "23505",
      detail: "Key (email)=(invented.person@example.test) already exists.",
    });
    const wrapped = failure(
      'Failed query: insert into "user_accounts" ...\nparams: invented.person@example.test',
      { cause: postgres }
    );

    expect(describeFailure(wrapped)).toBe("23505");
  });

  it("labels pg's code-less timeouts and lost connections, even under a wrapper", () => {
    expect(describeFailure(failure("Connection terminated due to connection timeout"))).toBe(
      "timeout"
    );
    expect(describeFailure(failure("timeout expired"))).toBe("timeout");
    expect(
      describeFailure(
        failure("Failed query: rollback", { cause: failure("Connection terminated unexpectedly") })
      )
    ).toBe("connection_lost");
  });

  it("labels pg-pool's full-pool timeout", () => {
    expect(describeFailure(failure("timeout exceeded when trying to connect"))).toBe("timeout");
  });

  it("labels a rollback on a connection pg already lost as connection_lost", () => {
    for (const message of [
      "Client has encountered a connection error and is not queryable",
      "Client was closed and is not queryable",
    ]) {
      expect(describeFailure(failure("Failed query: rollback", { cause: failure(message) }))).toBe(
        "connection_lost"
      );
    }
  });

  it("prefers a code anywhere in the chain to a fixed message", () => {
    const lost = failure("Connection terminated unexpectedly", {
      cause: failure("read", { code: "ECONNRESET" }),
    });

    expect(describeFailure(lost)).toBe("ECONNRESET");
  });

  it("gives unknown for anything else, and never the error's text", () => {
    expect(describeFailure(failure("could not reach invented.person@example.test"))).toBe(
      "unknown"
    );
    expect(describeFailure("a thrown string")).toBe("unknown");
    expect(describeFailure(undefined)).toBe("unknown");
  });

  it("ignores a code that isn't shaped like one", () => {
    expect(describeFailure(failure("odd", { code: "invented.person@example.test" }))).toBe(
      "unknown"
    );
  });

  it("stops on a cause chain that loops", () => {
    const first = failure("first");
    const second = failure("second", { cause: first });
    Object.assign(first, { cause: second });

    expect(describeFailure(first)).toBe("unknown");
  });
});

describe("isDatabaseQueryError", () => {
  it("recognizes what a failed query throws", async () => {
    const error = await failureOf((connection) => connection.check());

    expect(isDatabaseQueryError(error)).toBe(true);
  });

  it("is false for any other error", () => {
    expect(isDatabaseQueryError(new Error("Failed query: select 1"))).toBe(false);
    expect(isDatabaseQueryError("a thrown string")).toBe(false);
    expect(isDatabaseQueryError(undefined)).toBe(false);
  });

  // A connection the transaction can't open fails before any query runs, so it isn't a query
  // error. Its message is pg's own, with no query parameters in it.
  it("is false for a transaction that can't get a connection", async () => {
    const error = await failureOf((connection) => connection.transaction(async () => undefined));

    expect(isDatabaseQueryError(error)).toBe(false);
  });
});
