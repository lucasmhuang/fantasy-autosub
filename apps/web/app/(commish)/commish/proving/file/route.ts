import type { NextRequest } from "next/server";
import { commissionerFromPost, redirectTo } from "../../../../../lib/server/commish-settings";
import { fileProvingRequest } from "../../../../../lib/server/proving";
import type { SubmitResult } from "../../../../../lib/server/requests";

// The commissioner files a proving request on team 1 (S9), then sees it on the proving page, or
// why it wasn't accepted.
export async function POST(request: NextRequest) {
  const now = new Date();
  const commissioner = await commissionerFromPost(request, now, "/commish/proving");
  if (commissioner instanceof Response) return commissioner;

  const form = await request.formData();
  const user = { ...commissioner, role: "commissioner" as const };
  const result = await fileProvingRequest({ user, form, now });
  return redirectTo(`/commish/proving?status=${statusOf(result)}`);
}

// What the page says after a filing: the refusal, or what happens next for a request that waits
// for approval, runs on the worker's next pass, or can't run as the league is set (S18).
function statusOf(result: SubmitResult): string {
  if (result.status === "refused") return result.reason;
  if (result.status !== "recorded") return result.status;
  if (result.requestStatus === "queued") return "proving_queued";
  return result.requestStatus === "needs_review" ? "proving_held" : "proving_filed";
}
