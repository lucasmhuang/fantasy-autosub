import { describe, expect, it } from "vitest";
import { describeFailure } from "./failure";

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
