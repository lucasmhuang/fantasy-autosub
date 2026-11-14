import { type RequestStatusMessage, renderRequestStatus } from "../../(app)/app/status-messages";

const success = (body: string): RequestStatusMessage => ({ body, tone: "success" });
const danger = (body: string): RequestStatusMessage => ({ body, tone: "danger" });

// What a commissioner route wrote into the address (?status=).
const messages: Record<string, RequestStatusMessage> = {
  approved: success("Approved. InjurySub checks ESPN again, then carries it out."),
  reapproved: success("Re-approved. InjurySub writes the adjustment next."),
  amount_changed: danger(
    "The adjustment changed while you were looking, so nothing was approved. Here is the amount now."
  ),
  week_ended: danger(
    "This request's matchup week has ended, so it can't be approved. Settle it by hand."
  ),
  automation_off: danger(
    "Automation is off, so nothing can be approved. Turn it on in the settings, or settle this by hand."
  ),
  not_allowlisted: danger(
    "InjurySub doesn't change this team's lineup yet, so this can't be approved. Add the team in the settings, or settle this by hand."
  ),
  rejected: success("Rejected. The manager sees your reason."),
  override_set: success("Override saved. The computed amount is kept beside it."),
  completed_manually: success("Recorded as completed by hand."),
  reversed: success("Recorded as reversed. Enter the inverse adjustment shown on ESPN."),
  saved: success("Settings saved. Requests confirmed from now on follow them."),
  settings_changed: danger(
    "The settings changed while you were looking, so nothing was saved. Here they are now."
  ),
  not_allowed: danger("That action doesn't apply to this request as it stands."),
  changed: danger("This request changed while you were looking. Here's where it stands now."),
  invalid_form: danger("Something in the form wasn't valid. Check it and try again."),
  espn_unreachable: danger("ESPN couldn't be read, so nothing was recorded. Try again."),
  week_moved_on: danger(
    "ESPN has moved past this request's matchup, so the amount can't be recomputed. Set an override first."
  ),
  not_found: danger("That request doesn't exist."),
  // Filing on a team's behalf (Q16).
  own_team_on_behalf: danger("Refused: you can't file on behalf of your own team."),
  game_had_started: danger("Refused: the replacement's game had already started at that moment."),
  points_needed_mid_game: danger(
    "Refused: he was mid-game, so enter his points before the request, with a note."
  ),
  hand_entry_needs_final_line: danger(
    "Refused: hand-entered points need his final line for that day; file it once his day is over."
  ),
  hand_entry_out_of_range: danger(
    "Refused: the points entered are outside 0 and his final line for that day."
  ),
  moment_outside_matchup: danger("That moment isn't in this matchup week."),
  // The proving request (S9, S18, S19).
  proving_filed: success("Filed. Approve it below to run it on team 1."),
  cancelled: success("Cancelled. Nothing was sent to ESPN for it."),
  proving_marked_done: success("Proving is marked done. No more proving requests can be filed."),
  proving_done: danger(
    "Refused: proving is marked done, so no more proving requests can be filed."
  ),
  unavailable: danger("Something went wrong on our side. Try again in a moment."),
};

// The commissioner's own messages, else any a manager's request could carry.
export function renderCommissionerStatus(status: string | null): RequestStatusMessage | null {
  if (status !== null && Object.hasOwn(messages, status)) return messages[status] ?? null;
  return renderRequestStatus(status);
}
