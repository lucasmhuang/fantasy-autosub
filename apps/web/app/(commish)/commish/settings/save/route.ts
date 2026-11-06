import type { NextRequest } from "next/server";
import {
  commissionerFromPost,
  redirectTo,
  saveSettings,
} from "../../../../../lib/server/commish-settings";

// The commissioner saves the execution mode and the teams automation may act for.
export async function POST(request: NextRequest) {
  const now = new Date();
  const commissioner = await commissionerFromPost(request, now, "/commish/settings");
  if (commissioner instanceof Response) return commissioner;

  const form = await request.formData();
  const result = await saveSettings({ actorUserId: commissioner.userId, form, now });
  return redirectTo(`/commish/settings?status=${result.status}`);
}
