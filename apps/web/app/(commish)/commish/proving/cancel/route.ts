import type { NextRequest } from "next/server";
import { commissionerFromPost, redirectTo } from "../../../../../lib/server/commish-settings";
import { cancelProvingRequest } from "../../../../../lib/server/proving";

export async function POST(request: NextRequest) {
  const now = new Date();
  const commissioner = await commissionerFromPost(request, now, "/commish/proving");
  if (commissioner instanceof Response) return commissioner;

  const form = await request.formData();
  const result = await cancelProvingRequest({ actorUserId: commissioner.userId, form, now });
  return redirectTo(`/commish/proving?status=${result.status}`);
}
