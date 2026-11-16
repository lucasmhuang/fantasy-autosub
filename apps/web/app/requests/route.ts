import { loadServerEnv } from "@injurysub/config";
import { type NextRequest, NextResponse } from "next/server";
import { refuseCrossSitePost, sessionFromRequest } from "../../lib/server/auth";
import {
  EDIT_DIGEST,
  type SubmitResult,
  submitSubstitutionRequest,
} from "../../lib/server/requests";

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
    // The marker plays the swap once, or offers a refusal's way back to the options; the request
    // page drops it from the address. A refusal is kept as a request (IF-CONFIRM-7).
    case "recorded":
    case "refused":
      return `/app/requests/${result.requestId}?from=confirm`;
    case "espn_unreachable":
    case "edit_changed":
    case "unavailable": {
      const replacement = playerIdIn(form, "replacement");
      const query = new URLSearchParams({ injured, replacement, status: result.status });
      // The edit shown, so the summary shown again can name who moves now (IF-CONFIRM-5).
      const shown = form.get("edit");
      if (
        result.status === "edit_changed" &&
        typeof shown === "string" &&
        EDIT_DIGEST.test(shown)
      ) {
        query.set("was", shown);
      }
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
