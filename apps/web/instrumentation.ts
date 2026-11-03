// Next calls register() once as the server starts, never during `next build`. The settings check
// is Node-only, so it's imported only in the Node runtime.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { stopOnInvalidEnvironment } = await import("./lib/server/startup");
    stopOnInvalidEnvironment();
  }
}
