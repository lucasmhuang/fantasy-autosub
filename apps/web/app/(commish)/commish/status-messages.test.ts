import { describe, expect, it } from "vitest";
import { renderCommissionerStatus } from "./status-messages";

describe("renderCommissionerStatus", () => {
  it("confirms a manual completion", () => {
    expect(renderCommissionerStatus("completed_manually")).toEqual({
      body: "Settled by hand.",
      tone: "success",
    });
  });

  it("confirms an approval, and says why one was refused", () => {
    expect(renderCommissionerStatus("approved")?.tone).toBe("success");
    expect(renderCommissionerStatus("reapproved")?.tone).toBe("success");
    expect(renderCommissionerStatus("amount_changed")).toEqual({
      body: "The adjustment changed while you were looking; nothing was approved.",
      tone: "danger",
    });
    expect(renderCommissionerStatus("week_ended")?.body).toContain("week has ended");
    expect(renderCommissionerStatus("automation_off")?.body).toContain("Automation is off");
    expect(renderCommissionerStatus("not_allowlisted")?.body).toContain("ticked in Settings");
  });

  it("confirms a proving filing, a cancel and proving marked done, and says when filing is closed", () => {
    expect(renderCommissionerStatus("proving_filed")?.tone).toBe("success");
    expect(renderCommissionerStatus("proving_queued")?.body).toBe("Filed.");
    expect(renderCommissionerStatus("proving_filed")?.body).not.toContain("team 1");
    expect(renderCommissionerStatus("proving_held")).toMatchObject({ tone: "danger" });
    expect(renderCommissionerStatus("cancelled")?.tone).toBe("success");
    expect(renderCommissionerStatus("proving_marked_done")?.tone).toBe("success");
    expect(renderCommissionerStatus("proving_done")).toMatchObject({ tone: "danger" });
    expect(renderCommissionerStatus("proving_done")?.body).toContain("Proving is already done");
  });

  it("says a request held for an earlier credit needs the commissioner's amount first", () => {
    expect(renderCommissionerStatus("override_needed")).toMatchObject({ tone: "danger" });
    expect(renderCommissionerStatus("override_needed")?.body).toContain("override");
  });

  it("confirms an acknowledged alert and a switch of automation, and says when nothing changed", () => {
    expect(renderCommissionerStatus("acknowledged")?.tone).toBe("success");
    expect(renderCommissionerStatus("alert_not_found")?.tone).toBe("danger");
    expect(renderCommissionerStatus("automation_switched_off")?.body).toBe("Automation is off.");
    expect(renderCommissionerStatus("automation_switched_on")?.tone).toBe("success");
    expect(renderCommissionerStatus("automation_unchanged")?.tone).toBe("danger");
  });

  it("says when another tab acted first, and that nothing from this one was applied", () => {
    expect(renderCommissionerStatus("changed")).toEqual({
      body: "This request changed while you were looking; nothing was applied.",
      tone: "danger",
    });
  });

  // Table 3 (2026-11-20): each notice says what happened and stops; the buttons say what's next.
  it.for<[string, string]>([
    ["approved", "Approved."],
    ["reapproved", "Re-approved."],
    ["week_ended", "Its week has ended, so it can't be approved."],
    ["automation_off", "Automation is off, so it can't be approved."],
    ["not_allowlisted", "This team isn't ticked in Settings, so it can't be approved."],
    ["rejected", "Rejected."],
    ["override_set", "Override saved."],
    ["reversed", "Marked reversed."],
    ["invalid_form", "Something in the form wasn't valid."],
    ["espn_unreachable", "Couldn't read ESPN; nothing was recorded."],
    ["proving_filed", "Filed."],
    ["proving_held", "Filed, but it can't run as things stand."],
    ["cancelled", "Cancelled; nothing was sent."],
    ["proving_marked_done", "Proving is marked done."],
    ["acknowledged", "Acknowledged."],
    ["automation_unchanged", "Automation was already that way."],
  ])("says %s and stops", ([status, body]) => {
    expect(renderCommissionerStatus(status)?.body).toBe(body);
  });

  it("names the step a chained request needs, in the glossary's words", () => {
    const body = renderCommissionerStatus("override_needed")?.body;
    expect(body).toContain("earlier request");
    expect(body).toContain("settle it by hand");
    expect(renderCommissionerStatus("week_moved_on")?.body).toContain("Set an override first");
  });

  // A filing on a team's behalf is answered in the filing form's own words (filing-copy).
  it("explains any refusal a manager could get", () => {
    expect(renderCommissionerStatus("not_out")?.body).toBe(
      "That starter is no longer OUT on ESPN."
    );
  });

  it("shows nothing for no status, an unknown one, or an object's own property names", () => {
    for (const status of [null, "not_a_status", "__proto__", "hasOwnProperty"]) {
      expect(renderCommissionerStatus(status)).toBeNull();
    }
  });
});
