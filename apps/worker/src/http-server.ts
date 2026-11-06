import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Logger } from "@injurysub/config";
import {
  EspnError,
  type EspnReadClient,
  INTERNAL_READS,
  type InternalReadAnswer,
  type InternalReadName,
} from "@injurysub/espn";
import { answerHealth, type WorkerHealthDependencyCheck, type WorkerRuntimeState } from "./health";

export type WorkerHttpServerOptions = {
  port: number;
  runtimeState: WorkerRuntimeState;
  logger: Logger;
  dependencyChecks: WorkerHealthDependencyCheck[];
  isReady: () => boolean;
  espn: Pick<EspnReadClient, InternalReadName>;
  internalToken: string;
};

// Arguments are a small JSON object; anything larger isn't a read's.
const MAX_BODY_BYTES = 16 * 1024;

// How each internal read calls the client, with arguments its schema has checked.
const INVOKERS: {
  [Name in InternalReadName]: (
    espn: Pick<EspnReadClient, InternalReadName>,
    args: unknown
  ) => Promise<unknown>;
} = {
  getTeamWeek: (espn, args) => espn.getTeamWeek(INTERNAL_READS.getTeamWeek.args.parse(args).teamId),
  checkLeagueRules: (espn) => espn.checkLeagueRules(),
};

// The worker's one HTTP server: /health for Railway and the operator, and the internal read API
// the web calls over the private network with the shared bearer token. The API only reads.
export function startWorkerHttpServer(options: WorkerHttpServerOptions): Server {
  const server = createServer((request, response) => {
    void route(request, response, options).catch((error: unknown) => {
      options.logger.error("worker.http.failed", error);
      if (!response.headersSent) send(response, 500, { ok: false, code: "internal_error" });
    });
  });
  server.listen(options.port, () => {
    options.logger.info("worker.http.ready", { port: options.port });
  });
  return server;
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  options: WorkerHttpServerOptions
) {
  const { pathname } = new URL(request.url ?? "/", "http://127.0.0.1");
  if (pathname === "/health") {
    await answerHealth(response, { ...options, ready: options.isReady() });
    return;
  }
  if (!pathname.startsWith("/internal/"))
    return send(response, 404, { ok: false, code: "not_found" });
  if (!carriesToken(request, options.internalToken)) {
    return send(response, 401, { ok: false, code: "unauthorized" });
  }
  const name = readAt(pathname);
  if (name === null || request.method !== "POST") {
    return send(response, 404, { ok: false, code: "not_found" });
  }
  const args = INTERNAL_READS[name].args.safeParse(await jsonBodyOf(request));
  if (!args.success) return send(response, 400, { ok: false, code: "invalid_arguments" });
  await answerRead(response, name, args.data, options);
}

async function answerRead(
  response: ServerResponse,
  name: InternalReadName,
  args: unknown,
  options: WorkerHttpServerOptions
) {
  try {
    send(response, 200, { ok: true, result: await INVOKERS[name](options.espn, args) });
  } catch (error) {
    if (!(error instanceof EspnError)) throw error;
    options.logger.warn("worker.internal_api.espn_failed", { read: name, code: error.code });
    send(response, 502, { ok: false, code: error.code });
  }
}

function readAt(pathname: string): InternalReadName | null {
  const entry = Object.entries(INTERNAL_READS).find(([, read]) => read.path === pathname);
  return entry === undefined ? null : (entry[0] as InternalReadName);
}

// Compared as SHA-256 digests, so the comparison takes the same time whatever the token's length.
function carriesToken(request: IncomingMessage, token: string): boolean {
  const header = request.headers.authorization ?? "";
  const given = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return given !== "" && timingSafeEqual(digest(given), digest(token));
}

// The request's JSON body, or undefined when it isn't JSON or is too large.
async function jsonBodyOf(request: IncomingMessage): Promise<unknown> {
  let text = "";
  for await (const chunk of request) {
    text += String(chunk);
    if (text.length > MAX_BODY_BYTES) return undefined;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

function send(
  response: ServerResponse,
  status: number,
  body: InternalReadAnswer | { ok: false; code: string }
) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}
