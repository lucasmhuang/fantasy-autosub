import { describeFailure } from "@injurysub/db";
import { getWebLogger } from "./logger";

// Next's onRequestError: a failure no page or route handled, as one structured line with its
// route pattern and a fixed label (describeFailure), never the path (its query can carry an
// address). In production Next still prints the whole error after this hook, message included,
// so keeping a query's parameters out of the logs stays each loader's catch's job.
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
