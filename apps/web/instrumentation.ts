// Next calls register() once as the server starts, never during `next build`. The settings check
// is Node-only, so it's imported only in the Node runtime.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { stopOnInvalidEnvironment } = await import("./lib/server/startup");
    stopOnInvalidEnvironment();
  }
}

// A failure no page or route handled (AC1-10): logged by route and a fixed label, never its message.
export async function onRequestError(
  error: unknown,
  request: { method: string; path: string },
  context: { routePath: string; routeType: string }
) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logRequestFailure } = await import("./lib/server/request-failure");
  logRequestFailure(error, request, context);
}
