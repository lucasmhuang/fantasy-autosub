import { loadServerEnv } from "@injurysub/config";
import { type NextRequest, NextResponse } from "next/server";
import { refuseCrossSitePost, sessionFromRequest } from "../../../../lib/server/auth";
import { withdrawRequest } from "../../../../lib/server/requests";

// A manager withdraws their team's request; the request's page says how it went.
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const refusal = refuseCrossSitePost(request);
  if (refusal) return refusal;

  const now = new Date();
  const session = await sessionFromRequest(request, now);
  if (!session) return redirectTo("/login?redirect=/app");
  const { userId, role, teamId } = session.user;
  if (teamId === null) return redirectTo("/app");

  const { id } = await context.params;
  const result = await withdrawRequest({ user: { userId, role, teamId }, requestId: id, now });
  if (result.status === "not_found") return redirectTo("/app?status=not_found");
  return redirectTo(`/app/requests/${id}?status=${result.status}`);
}

// On the app's own address: behind the host's proxy, request.url is the server's internal one.
function redirectTo(path: string) {
  return NextResponse.redirect(new URL(path, loadServerEnv().APP_BASE_URL), { status: 303 });
}
