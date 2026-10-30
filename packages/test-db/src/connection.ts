import { Client } from "pg";

// The URL of another database on the same server, with the rest kept (sslmode included).
export function urlOfDatabase(serverUrl: string, database: string): string {
  const url = new URL(serverUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

// Opens one connection, hands it to `use`, and closes it. Connecting and each query have a time
// limit, since Vitest sets none on a global setup or a fixture's teardown.
export async function withClient<T>(
  url: string,
  use: (client: Client) => Promise<T>,
  { timeoutMs }: { timeoutMs: number }
): Promise<T> {
  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: timeoutMs,
    query_timeout: timeoutMs,
  });
  // pg also reports a lost connection as an `error` event, which crashes the process when nothing
  // listens for it. A failed query already carries the error; a loss after the work is thrown here.
  let lost: Error | undefined;
  client.on("error", (error) => {
    lost = error;
  });
  await client.connect();
  try {
    const result = await use(client);
    if (lost !== undefined) throw lost;
    return result;
  } finally {
    await client.end();
  }
}
