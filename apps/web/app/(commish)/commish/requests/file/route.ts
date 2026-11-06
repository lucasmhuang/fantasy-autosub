import type { NextRequest } from "next/server";
import { commissionerFromPost, redirectTo } from "../../../../../lib/server/commish-settings";
import { fileOnBehalfRequest } from "../../../../../lib/server/on-behalf";

// The commissioner files a request on a team's behalf (Q16), then sees it, or the form again with
// why it wasn't accepted.
export async function POST(request: NextRequest) {
  const now = new Date();
  const commissioner = await commissionerFromPost(request, now, "/commish/requests/new");
  if (commissioner instanceof Response) return commissioner;

  const form = await request.formData();
  const session = {
    userId: commissioner.userId,
    role: "commissioner" as const,
    teamId: commissioner.teamId,
  };
  const result = await fileOnBehalfRequest({ user: session, form, now });
  if (result.status === "recorded") return redirectTo(`/commish/requests/${result.requestId}`);
  const team = Number(form.get("team"));
  const status = result.status === "refused" ? result.reason : result.status;
  const query = new URLSearchParams({
    status,
    ...(Number.isSafeInteger(team) ? { team: String(team) } : {}),
  });
  return redirectTo(`/commish/requests/new?${query}`);
}
