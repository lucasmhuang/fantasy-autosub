import type { NextRequest } from "next/server";
import { switchAnswerPage, switchAutomationBy } from "../../../../../lib/server/commish-alerts";
import { commissionerFromPost, redirectTo } from "../../../../../lib/server/commish-settings";

// The off switch on every commissioner page (O11, Dec-D31e). Requests then wait in the queue.
export async function POST(request: NextRequest) {
  const now = new Date();
  const commissioner = await commissionerFromPost(request, now, "/commish/requests");
  if (commissioner instanceof Response) return commissioner;

  const page = switchAnswerPage((await request.formData()).get("from"));
  const result = await switchAutomationBy({ on: true, actorUserId: commissioner.userId, now });
  return redirectTo(`${page}?status=${result.status}`);
}
