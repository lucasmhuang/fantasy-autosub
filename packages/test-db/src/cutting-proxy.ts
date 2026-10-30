import { connect, createServer, type Server, type Socket } from "node:net";

export type CuttingProxy = { url: string; close: () => Promise<void> };

// A local TCP proxy to a test database that cuts a connection, both ways, the moment its client
// sends a message holding `statement`: a network drop at that point, for code that must survive
// one. The match is on the raw bytes, so pick a statement no earlier message contains. Connect
// through `url`; `close()` stops the proxy.
export async function cutConnectionAt(
  databaseUrl: string,
  statement: string
): Promise<CuttingProxy> {
  const target = new URL(databaseUrl);
  const sockets = new Set<Socket>();
  const server = createServer((client) => {
    const upstream = connect(Number(target.port), target.hostname);
    const cut = () => {
      client.destroy();
      upstream.destroy();
    };
    for (const socket of [client, upstream]) {
      sockets.add(socket);
      // Either side failing or closing ends the pair, as a cut does.
      socket.on("error", cut);
      socket.on("close", () => {
        cut();
        sockets.delete(socket);
      });
    }
    upstream.on("data", (chunk: Buffer) => client.write(chunk));
    client.on("data", (chunk: Buffer) => {
      if (chunk.includes(statement)) cut();
      else upstream.write(chunk);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const proxied = new URL(databaseUrl);
  proxied.hostname = "127.0.0.1";
  proxied.port = String(typeof address === "object" && address !== null ? address.port : 0);
  return { url: proxied.toString(), close: () => stopProxy(server, sockets) };
}

async function stopProxy(server: Server, sockets: Set<Socket>): Promise<void> {
  for (const socket of sockets) socket.destroy();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
