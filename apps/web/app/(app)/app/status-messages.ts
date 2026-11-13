export type RequestStatusMessage = { body: string; tone: "success" | "danger" | "muted" };

const danger = (body: string): RequestStatusMessage => ({ body, tone: "danger" });

// What a substitution route wrote into the address (?status=), as the page says it.
const messages: Record<string, RequestStatusMessage> = {
  // Refusals at Confirm (R9, R10, R17, R21, D21), recorded with the request.
  not_out: danger("Player is no longer listed as OUT."),
  injured_not_starting: danger("That starter is no longer in your starting lineup."),
  replacement_not_on_bench: danger("That player is no longer on your bench."),
  replacement_cannot_start: danger(
    "No valid lineup can take that player in your starter's place anymore."
  ),
  active_request_exists: danger("That starter already has a request this week."),
  replacement_in_flight: danger(
    "That player is the replacement in another of your requests, still in progress."
  ),
  week_over: danger("This matchup week is over, so it can't take a substitution."),
  after_final_game: danger(
    "This matchup's last game is over, so it can't take a substitution anymore. Next week's lineup can be set in ESPN before the player's first game."
  ),
  not_your_team: danger("That isn't your team."),
  // Nothing recorded (R18, R20).
  not_on_team: danger("That player isn't on your team."),
  no_matchup: danger("Your team has no matchup this week, so there's nothing to substitute."),
  invalid_form: danger("That request was incomplete. Choose the replacement again."),
  // R4, R21: what the Confirm page showed no longer holds, so nothing was recorded.
  edit_changed: danger(
    "The lineup change for this swap is different now. Check the new one below, and confirm again if it still suits you."
  ),
  week_changed: danger(
    "This matchup week is over, so it can't take a substitution. Next week's lineup can be set in ESPN before the player's first game."
  ),
  espn_unreachable: danger(
    "The app couldn't check ESPN, so nothing was recorded. Try again, or contact the commissioner."
  ),
  unavailable: danger("Something went wrong on our side. Try again in a moment."),
  // Withdraw (OQ6).
  withdrawn: { body: "Request withdrawn. You can choose a replacement again.", tone: "success" },
  cannot_withdraw: danger(
    "This request can't be withdrawn anymore: it's settled, or its lineup change already went to ESPN."
  ),
  changed: danger("This request changed while you were looking. Here's where it stands now."),
  not_found: danger("That request isn't one of your team's."),
};

export function renderRequestStatus(status: string | null): RequestStatusMessage | null {
  return status !== null && Object.hasOwn(messages, status) ? (messages[status] ?? null) : null;
}
