import type { NextRequest } from "next/server";
import { commissionerFromPost, redirectTo } from "../../../../../lib/server/commish-settings";
import { markProvingDoneBy } from "../../../../../lib/server/proving";

export async function POST(request: NextRequest) {
  const now = new Date();
  const commissioner = await commissionerFromPost(request, now, "/commish/proving");
  if (commissioner instanceof Response) return commissioner;

  const result = await markProvingDoneBy({ actorUserId: commissioner.userId, now });
  // Revision 4, E: proving is marked done from Settings, which answers it.
  return redirectTo(`/commish/settings?status=${result.status}`);
}
