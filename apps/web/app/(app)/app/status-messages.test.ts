import type { RequestRefusalReason } from "@injurysub/domain";
import { describe, expect, it } from "vitest";
import type { SubmitResult, WithdrawResult } from "../../../lib/server/requests";
import { renderRequestStatus } from "./status-messages";

// Refusals only the commissioner's on-behalf and proving filings can store; the commissioner's
// own copy covers them.
type CommissionerFilingRefusal =
  | "commissioner_only"
  | "own_team_on_behalf"
  | "proving_team_only"
  | "proving_done"
  | "attestation_needed"
  | "game_had_started"
  | "points_needed_mid_game"
  | "hand_entry_needs_final_line"
  | "hand_entry_out_of_range";
type ConfirmRefusal = Exclude<RequestRefusalReason, CommissionerFilingRefusal>;
type SubmitStatus = Exclude<SubmitResult["status"], "refused" | "recorded">;

const confirmRefusals = [
  "not_your_team",
  "week_over",
  "after_final_game",
  "injured_not_starting",
  "not_out",
  "replacement_not_on_bench",
  "replacement_cannot_start",
  "active_request_exists",
  "replacement_in_flight",
] as const satisfies readonly ConfirmRefusal[];
const submitStatuses = [
  "invalid_form",
  "espn_unreachable",
  "no_matchup",
  "not_on_team",
  "unavailable",
  "edit_changed",
  "week_changed",
] as const satisfies readonly SubmitStatus[];
const withdrawStatuses = [
  "withdrawn",
  "not_found",
  "cannot_withdraw",
  "too_late",
  "changed",
  "unavailable",
] as const satisfies readonly WithdrawResult["status"][];

// A code added to one of these types without joining its list fails typecheck here, so it can't
// reach a manager's page with no message.
type Unlisted =
  | Exclude<ConfirmRefusal, (typeof confirmRefusals)[number]>
  | Exclude<SubmitStatus, (typeof submitStatuses)[number]>
  | Exclude<WithdrawResult["status"], (typeof withdrawStatuses)[number]>;
const everyCodeListed: [Unlisted] extends [never] ? true : never = true;

describe("renderRequestStatus", () => {
  // RS-CONFIRM-4: the copy may change; the codes may not lose it.
  it.for([
    ...confirmRefusals,
    ...submitStatuses,
    ...withdrawStatuses,
  ])("gives a message for %s, a code Confirm, a stored refusal or withdraw can write", (status) => {
    expect(everyCodeListed).toBe(true);
    expect(renderRequestStatus(status)?.body).toMatch(/\S/);
  });

  // IF-BOARD-8, FM-APP-2: a manager who opened a commissioner page.
  // FM-REQUEST-4.
  it("says it's too late to withdraw once the lineup change went to ESPN", () => {
    expect(renderRequestStatus("too_late")).toEqual({
      body: "Too late to withdraw: the lineup change had already gone to ESPN.",
      tone: "warning",
    });
  });

  it("says a commissioner page is commissioner-only", () => {
    expect(renderRequestStatus("commissioner_page")).toEqual({
      body: "That page is commissioner-only.",
      tone: "muted",
    });
  });

  it("gives the PRD's words when the starter is no longer OUT", () => {
    expect(renderRequestStatus("not_out")).toEqual({
      body: "Player is no longer listed as OUT.",
      tone: "danger",
    });
  });

  it("says nothing was recorded when ESPN couldn't be checked", () => {
    expect(renderRequestStatus("espn_unreachable")?.body).toBe(
      "Couldn't check ESPN just now, so nothing was recorded."
    );
  });

  // FM-CONFIRM-8, -9 and AC3-1: nothing recorded, in the canvas's words.
  it("says nothing was recorded for a team with no matchup, a failure on our side, or a changed edit", () => {
    expect(renderRequestStatus("no_matchup")?.body).toBe(
      "Your team has no matchup this week. Nothing was recorded."
    );
    expect(renderRequestStatus("unavailable")?.body).toBe(
      "Something went wrong, and nothing was recorded."
    );
    expect(renderRequestStatus("edit_changed")?.body).toBe(
      "Your ESPN lineup changed since you looked: the moves below are the new ones. Nothing was recorded."
    );
  });

  // D21: a request after the final day's last game, before ESPN's day change.
  it("says next week's lineup can still be set in ESPN after a matchup's last game", () => {
    expect(renderRequestStatus("after_final_game")?.body).toBe(
      "The week's last game has ended, so no more swaps this week. Next week's lineup can already be set on ESPN, before your players' first games."
    );
  });

  it("shows nothing for no status, an unknown one, or an object's own property names", () => {
    for (const status of [null, "not_a_status", "__proto__", "toString"]) {
      expect(renderRequestStatus(status)).toBeNull();
    }
  });
});
