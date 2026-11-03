import { NextResponse } from "next/server";
import { getWebDatabaseConnection } from "../../../lib/server/db";
import { getWebLogger } from "../../../lib/server/logger";

export async function GET() {
  try {
    await getWebDatabaseConnection().check();

    return NextResponse.json({
      ok: true,
      dependencies: {
        database: "ok",
      },
      service: "web",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    // Public: the body says only that the database failed. The log says how.
    getWebLogger().error("web.health.database_failed", error);

    return NextResponse.json(
      {
        ok: false,
        dependencies: {
          database: "error",
        },
        service: "web",
        timestamp: new Date().toISOString(),
      },
      {
        status: 503,
      }
    );
  }
}
