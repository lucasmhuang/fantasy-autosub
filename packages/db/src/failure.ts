// Node errnos (ECONNREFUSED), SQLSTATEs (23505, 28P01) and TLS codes are all of this shape.
const CODE_SHAPE = /^[A-Z0-9_]{2,64}$/;

// pg's fixed messages for failures that carry no code: pg-pool 3.13.0 index.js:276, and pg 8.20
// lib/client.js:150, :180, :641, :678 and :685. :641 is a query past its query_timeout; the last
// two are a query, such as drizzle's rollback, on a connection pg had already lost.
const FIXED_MESSAGES = new Map([
  ["Connection terminated due to connection timeout", "timeout"],
  ["timeout expired", "timeout"],
  ["Query read timeout", "timeout"],
  ["Connection terminated unexpectedly", "connection_lost"],
  ["Client has encountered a connection error and is not queryable", "connection_lost"],
  ["Client was closed and is not queryable", "connection_lost"],
]);

// A safe reason for a failure: the first code along its cause chain, else the label of one of pg's
// fixed messages, else "unknown". It never returns any of the errors' own text, which can hold a
// query's parameters, an address, or a database URL.
export function describeFailure(error: unknown): string {
  const chain = causeChain(error);
  const code = chain.map(codeOf).find((candidate) => candidate !== undefined);
  if (code !== undefined) return code;
  const label = chain.map((link) => FIXED_MESSAGES.get(link.message)).find(Boolean);
  return label ?? "unknown";
}

function causeChain(error: unknown): Error[] {
  const chain: Error[] = [];
  let current = error;
  // The cap also ends a chain that loops back on itself.
  while (current instanceof Error && chain.length < 10) {
    chain.push(current);
    current = current.cause;
  }
  return chain;
}

function codeOf(error: Error): string | undefined {
  const code: unknown = Reflect.get(error, "code");
  return typeof code === "string" && CODE_SHAPE.test(code) ? code : undefined;
}
