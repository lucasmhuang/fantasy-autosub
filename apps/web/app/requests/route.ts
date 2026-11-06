import { loadServerEnv } from "@injurysub/config";
import { type NextRequest, NextResponse } from "next/server";
import { refuseCrossSitePost, sessionFromRequest } from "../../lib/server/auth";
import { type SubmitResult, submitSubstitutionRequest } from "../../lib/server/requests";

// Confirm on a substitution request: re-checks ESPN and records it, then sends the manager to the
// request's page, back to their options with the reason, or back to Confirm to try again.
export async function POST(request: NextRequest) {
  const refusal = refuseCrossSitePost(request);
  if (refusal) return refusal;

  const now = new Date();
  const session = await sessionFromRequest(request, now);
  if (!session) return redirectTo("/login?redirect=/app");
  const { userId, role, teamId } = session.user;
  if (teamId === null) return redirectTo("/app");

  const form = await request.formData();
  const result = await submitSubstitutionRequest({ user: { userId, role, teamId }, form, now });
  return redirectTo(locationFor(result, form));
}

function locationFor(result: SubmitResult, form: FormData): string {
  const injured = playerIdIn(form, "injured");
  switch (result.status) {
    case "recorded":
      return `/app/requests/${result.requestId}`;
    case "refused":
      return `/app?${new URLSearchParams({ starter: injured, status: result.reason })}`;
    case "espn_unreachable":
    case "unavailable": {
      const replacement = playerIdIn(form, "replacement");
      const query = new URLSearchParams({ injured, replacement, status: result.status });
      return `/app/requests/new?${query}`;
    }
    default:
      return `/app?status=${result.status}`;
  }
}

// Only digits go back into an address.
function playerIdIn(form: FormData, field: string): string {
  const value = form.get(field);
  return typeof value === "string" && /^\d{1,12}$/.test(value) ? value : "";
}

// On the app's own address: behind the host's proxy, request.url is the server's internal one.
function redirectTo(path: string) {
  return NextResponse.redirect(new URL(path, loadServerEnv().APP_BASE_URL), { status: 303 });
}
