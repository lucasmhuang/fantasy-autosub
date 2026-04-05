import { NextResponse } from "next/server";
import { getWebDatabaseConnection } from "../../../lib/server/db";

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
    return NextResponse.json(
      {
        ok: false,
        dependencies: {
          database: "error",
        },
        error: error instanceof Error ? error.message : "unknown_database_error",
        service: "web",
        timestamp: new Date().toISOString(),
      },
      {
        status: 503,
      }
    );
  }
}
