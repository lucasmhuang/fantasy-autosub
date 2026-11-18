import { describe, expect, it } from "vitest";
import { misuseAlertTitle } from "./alerts";

// Copy table 1, M: one title per kind, shared by the misuse watch page, the queue and the email.
describe("misuseAlertTitle", () => {
  it.for([
    ["lm_transaction", "Lineup change on Backdoor Cutters"],
    ["lm_adjustment", "Adjustment on Backdoor Cutters"],
    ["lm_league_change", "League settings changed"],
    ["adjustment_mismatch", "Adjustment differs on Backdoor Cutters"],
    ["league_public", "The league is public"],
  ] as const)("titles %s as %s", ([kind, title]) => {
    expect(misuseAlertTitle(kind, "Backdoor Cutters")).toBe(title);
  });

  it("says a team where an alert names none", () => {
    expect(misuseAlertTitle("lm_transaction", null)).toBe("Lineup change on a team");
  });
});
