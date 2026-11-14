import type { NextRequest } from "next/server";
import { commissionerFromPost, redirectTo } from "../../../../../lib/server/commish-settings";
import { fileProvingRequest } from "../../../../../lib/server/proving";

// The commissioner files a proving request on team 1 (S9), then sees it on the proving page, or
// why it wasn't accepted.
export async function POST(request: NextRequest) {
  const now = new Date();
  const commissioner = await commissionerFromPost(request, now, "/commish/proving");
  if (commissioner instanceof Response) return commissioner;

  const form = await request.formData();
  const user = { ...commissioner, role: "commissioner" as const };
  const result = await fileProvingRequest({ user, form, now });
  const status =
    result.status === "recorded"
      ? "proving_filed"
      : result.status === "refused"
        ? result.reason
        : result.status;
  return redirectTo(`/commish/proving?status=${status}`);
}
