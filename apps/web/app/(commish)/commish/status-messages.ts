import type { RequestStatusMessage } from "../../(app)/app/status-messages";

const success = (body: string): RequestStatusMessage => ({ body, tone: "success" });
const danger = (body: string): RequestStatusMessage => ({ body, tone: "danger" });

// What a commissioner route wrote into the address (?status=).
const messages: Record<string, RequestStatusMessage> = {
  rejected: success("Rejected. The manager sees your reason."),
  override_set: success("Override saved. The computed amount is kept beside it."),
  completed_manually: success("Recorded as completed by hand."),
  reversed: success("Recorded as reversed. Enter the inverse adjustment shown on ESPN."),
  saved: success("Settings saved. Requests confirmed from now on follow them."),
  not_allowed: danger("That action doesn't apply to this request as it stands."),
  changed: danger("This request changed while you were looking. Here's where it stands now."),
  invalid_form: danger("Something in the form wasn't valid. Check it and try again."),
  espn_unreachable: danger("ESPN couldn't be read, so nothing was recorded. Try again."),
  week_moved_on: danger(
    "ESPN has moved past this request's matchup, so the amount can't be recomputed. Set an override first."
  ),
  not_found: danger("That request doesn't exist."),
  unavailable: danger("Something went wrong on our side. Try again in a moment."),
};

export function renderCommissionerStatus(status: string | null): RequestStatusMessage | null {
  return status !== null && Object.hasOwn(messages, status) ? (messages[status] ?? null) : null;
}
