import { type RequestStatusMessage, renderRequestStatus } from "../../(app)/app/status-messages";

const success = (body: string): RequestStatusMessage => ({ body, tone: "success" });
const danger = (body: string): RequestStatusMessage => ({ body, tone: "danger" });

// What a commissioner route wrote into the address (?status=).
const messages: Record<string, RequestStatusMessage> = {
  approved: success("Approved."),
  reapproved: success("Re-approved."),
  amount_changed: danger("The adjustment changed while you were looking; nothing was approved."),
  week_ended: danger("Its week has ended, so it can't be approved."),
  automation_off: danger("Automation is off, so it can't be approved."),
  not_allowlisted: danger("This team isn't ticked in Settings, so it can't be approved."),
  rejected: success("Rejected."),
  override_set: success("Override saved."),
  completed_manually: success("Settled by hand."),
  reversed: success("Marked reversed."),
  // Saved and changed in another tab are the settings page's own, with the save's time
  // (settings-copy).
  not_allowed: danger("That action doesn't apply to this request as it stands."),
  changed: danger("This request changed while you were looking; nothing was applied."),
  invalid_form: danger("Something in the form wasn't valid."),
  espn_unreachable: danger("Couldn't read ESPN; nothing was recorded."),
  week_moved_on: danger(
    "ESPN is past this request's week, so the adjustment can't be recomputed. Set an override first."
  ),
  not_found: danger("That request doesn't exist."),
  override_needed: danger(
    "This starter came in through an earlier request this week, so the adjustment can't be computed. Set an override, then settle it by hand."
  ),
  // The proving request (S9, S18, S19).
  proving_filed: success("Filed."),
  proving_queued: success("Filed."),
  proving_held: danger("Filed, but it can't run as things stand."),
  cancelled: success("Cancelled; nothing was sent."),
  proving_marked_done: success("Proving is marked done."),
  proving_done: danger("Proving is already done."),
  // Misuse alerts and the off switch (M5, O11).
  acknowledged: success("Acknowledged."),
  alert_not_found: danger("That alert doesn't exist, or it was already acknowledged."),
  automation_switched_off: success("Automation is off."),
  automation_switched_on: success("Automation is back on, as it was before you turned it off."),
  automation_unchanged: danger("Automation was already that way."),
  unavailable: danger("Something went wrong. Try again in a moment."),
};

// The commissioner's own messages, else any a manager's request could carry.
export function renderCommissionerStatus(status: string | null): RequestStatusMessage | null {
  if (status !== null && Object.hasOwn(messages, status)) return messages[status] ?? null;
  return renderRequestStatus(status);
}
