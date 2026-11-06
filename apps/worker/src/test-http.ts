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

// A fetch over node:http for a test server on this machine, since tests can't use the real one.
// It sends the method, headers and a string body, and answers with the server's status, headers
// and body.
export async function localFetch(
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  const url = new URL(String(input));
  if (url.hostname !== "127.0.0.1")
    throw new Error(`localFetch reaches only 127.0.0.1: ${url.hostname}`);
  const headers = Object.fromEntries(new Headers(init?.headers).entries());
  return new Promise((resolve, reject) => {
    const outgoing = request(
      {
        host: url.hostname,
        port: url.port,
        path: url.pathname,
        method: init?.method ?? "GET",
        headers,
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
        });
        response.on("end", () =>
          resolve(
            new Response(body, {
              status: response.statusCode ?? 0,
              headers: { "content-type": String(response.headers["content-type"] ?? "") },
            })
          )
        );
      }
    );
    outgoing.on("error", reject);
    outgoing.end(typeof init?.body === "string" ? init.body : undefined);
  });
}
