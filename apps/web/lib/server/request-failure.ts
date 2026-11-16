import { describeFailure } from "@injurysub/db";
import { getWebLogger } from "./logger";

// Next's onRequestError: a failure no page or route handled. Logged by its route pattern and a
// fixed label (describeFailure) only: the request's path can carry an address in its query, and a
// drizzle error's message carries the query's parameters.
export function logRequestFailure(
  error: unknown,
  request: { method: string; path: string },
  context: { routePath: string; routeType: string }
): void {
  getWebLogger().error("web.request.failed", undefined, {
    route: context.routePath,
    routeType: context.routeType,
    method: request.method,
    reason: describeFailure(error),
  });
}
