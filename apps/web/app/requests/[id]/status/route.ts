import { describeFailure, isDatabaseQueryError } from "@injurysub/db";
import { type NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "../../../../lib/server/auth";
import { getWebLogger } from "../../../../lib/server/logger";
import {
  liveStatusOf,
  loadRequestView,
  loadRequestViewForCommissioner,
  type RequestView,
} from "../../../../lib/server/request-view";

const UNCACHED = { "cache-control": "no-store" };

// An open request page's check for changes: the request's status fields as JSON, for the team's
// own request or, for the commissioner, any team's. Another team's request, or one that isn't
// there, is 404, the same as an unknown id; a signed-out browser gets 401. It reads the session
// and sets no cookie.
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const session = await sessionFromRequest(request, new Date());
    if (!session) return new NextResponse(null, { status: 401, headers: UNCACHED });
    const view = await viewFor(session.user, id);
    if (view.status === "unavailable")
      return new NextResponse(null, { status: 503, headers: UNCACHED });
    if (view.status !== "found") return new NextResponse(null, { status: 404, headers: UNCACHED });
    return NextResponse.json(liveStatusOf(view), { headers: UNCACHED });
  } catch (error) {
    // The page keeps what it shows and checks again later; the log names the failure only.
    if (!isDatabaseQueryError(error)) throw error;
    getWebLogger().error("web.requests.status_unread", undefined, {
      reason: describeFailure(error),
    });
    return new NextResponse(null, { status: 503, headers: UNCACHED });
  }
}

function viewFor(
  user: { teamId: number | null; role: string },
  requestId: string
): Promise<RequestView> {
  if (user.role === "commissioner") return loadRequestViewForCommissioner(requestId);
  if (user.teamId === null) return Promise.resolve({ status: "not_found" });
  return loadRequestView({ teamId: user.teamId, requestId });
}
