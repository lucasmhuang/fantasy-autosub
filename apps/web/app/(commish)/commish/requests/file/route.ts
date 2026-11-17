import { type NextRequest, NextResponse } from "next/server";
import { commissionerFromPost, redirectTo } from "../../../../../lib/server/commish-settings";
import {
  type FilingFieldError,
  fileOnBehalfRequest,
  type OnBehalfResult,
} from "../../../../../lib/server/on-behalf";

// The commissioner files a request on a team's behalf (Q16), then sees it. The form posts with
// fetch and asks for JSON, so a filing with problems is answered in place with everything typed
// still on the page (IF-FILE-4); without script it posts plainly and goes back to the form with
// why, the team kept.
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
  const location =
    result.status === "recorded"
      ? `/commish/requests/${result.requestId}`
      : formLocation(form, result);
  if (!(request.headers.get("accept") ?? "").includes("application/json")) {
    return redirectTo(location);
  }
  if (result.status === "recorded") return NextResponse.json({ status: "recorded", location });
  return NextResponse.json(result);
}

function formLocation(form: FormData, result: Exclude<OnBehalfResult, { status: "recorded" }>) {
  const team = Number(form.get("team"));
  const query = new URLSearchParams({
    status: plainStatus(result),
    ...(Number.isSafeInteger(team) ? { team: String(team) } : {}),
  });
  return `/commish/requests/new?${query}`;
}

// Without script the form shows one sentence: the refusal's, else the first answer's, in the
// codes the form has always come back with.
const PLAIN_CODES: Partial<Record<FilingFieldError["code"], string>> = {
  before_week: "moment_outside_matchup",
  after_week: "moment_outside_matchup",
  game_had_started: "game_had_started",
  not_final: "hand_entry_needs_final_line",
  out_of_range: "hand_entry_out_of_range",
};

function plainStatus(result: Exclude<OnBehalfResult, { status: "recorded" }>): string {
  if (result.status !== "not_filed") return result.status;
  if (result.refusal !== null) return result.refusal;
  const [first] = result.errors;
  if (first?.field === "enteredPoints" && first.code === "missing") return "points_needed_mid_game";
  return (first === undefined ? undefined : PLAIN_CODES[first.code]) ?? "invalid_form";
}
