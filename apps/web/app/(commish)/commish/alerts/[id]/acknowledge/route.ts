import type { NextRequest } from "next/server";
import { acknowledgeAlertBy } from "../../../../../../lib/server/commish-alerts";
import { commissionerFromPost, redirectTo } from "../../../../../../lib/server/commish-settings";

// The commissioner acknowledges a misuse alert (M5): it stops being listed as open.
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const now = new Date();
  const commissioner = await commissionerFromPost(request, now, "/commish/alerts");
  if (commissioner instanceof Response) return commissioner;

  const { id } = await context.params;
  const result = await acknowledgeAlertBy({ alertId: id, userId: commissioner.userId, now });
  return redirectTo(`/commish/alerts?status=${result.status}`);
}
