import type { NextRequest } from "next/server";
import { actOnRequest } from "../../../../../../lib/server/commish-actions";
import { commissionerFromPost, redirectTo } from "../../../../../../lib/server/commish-settings";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const now = new Date();
  const commissioner = await commissionerFromPost(request, now, `/commish/requests/${id}`);
  if (commissioner instanceof Response) return commissioner;

  const form = await request.formData();
  const result = await actOnRequest({
    actorUserId: commissioner.userId,
    actorTeamId: commissioner.teamId,
    requestId: id,
    action: "reject",
    form,
    now,
  });
  if (result.status === "not_found") return redirectTo("/commish/requests?status=not_found");
  return redirectTo(`/commish/requests/${id}?status=${result.status}`);
}
