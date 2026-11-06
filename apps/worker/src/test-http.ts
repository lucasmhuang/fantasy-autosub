import { request, type Server } from "node:http";

// Tests can't use fetch (vitest.setup.ts guards it), so these ask over node:http. Test code only.
export function addressOf(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the server isn't listening on a TCP port");
  }
  return address.port;
}

export function askServer(
  server: Server,
  options: { method?: string; path: string; headers?: Record<string, string>; body?: string }
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const outgoing = request(
      {
        host: "127.0.0.1",
        port: addressOf(server),
        path: options.path,
        method: options.method ?? "GET",
        headers: options.headers,
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
        });
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
      }
    );
    outgoing.on("error", reject);
    outgoing.end(options.body);
  });
}
