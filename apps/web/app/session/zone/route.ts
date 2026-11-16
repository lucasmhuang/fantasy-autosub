import { describeFailure, isDatabaseQueryError, setSessionTimeZone } from "@injurysub/db";
import { canonicalZone } from "@injurysub/domain";
import { type NextRequest, NextResponse } from "next/server";
import { refuseCrossSitePost, sessionFromRequest } from "../../../lib/server/auth";
import { getWebDatabaseConnection } from "../../../lib/server/db";
import { getWebLogger } from "../../../lib/server/logger";

// The zone reporter's post: keeps the device's zone on this browser's session, so the pages
// after it show times in that zone. The session row holds it for as long as the sign-in lasts,
// so no cookie is set.
export async function POST(request: NextRequest) {
  const refusal = refuseCrossSitePost(request);
  if (refusal) return refusal;
  const zone = canonicalZone(String((await request.formData()).get("zone") ?? ""));

  try {
    const session = await sessionFromRequest(request, new Date());
    if (!session) return new NextResponse(null, { status: 401 });
    if (zone === null) return new NextResponse(null, { status: 400 });
    await setSessionTimeZone(getWebDatabaseConnection().db, session.session.sessionId, zone);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    // The reporter tries again on the next page; the log names the failure, never the query.
    if (!isDatabaseQueryError(error)) throw error;
    getWebLogger().error("web.session.zone_unsaved", undefined, { reason: describeFailure(error) });
    return new NextResponse(null, { status: 503 });
  }
}
