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
      body: "The adjustment changed while you were looking, so nothing was approved. Here's the adjustment now.",
      tone: "danger",
    });
    expect(renderCommissionerStatus("week_ended")?.body).toContain("by hand");
    expect(renderCommissionerStatus("automation_off")?.body).toContain("Automation is off");
    expect(renderCommissionerStatus("not_allowlisted")?.body).toContain("this team");
  });

  it("confirms a proving filing, a cancel and proving marked done, and says when filing is closed", () => {
    expect(renderCommissionerStatus("proving_filed")?.tone).toBe("success");
    expect(renderCommissionerStatus("proving_queued")?.body).toBe("Filed. InjurySub runs it next.");
    expect(renderCommissionerStatus("proving_filed")?.body).not.toContain("team 1");
    expect(renderCommissionerStatus("proving_held")).toMatchObject({ tone: "danger" });
    expect(renderCommissionerStatus("cancelled")?.tone).toBe("success");
    expect(renderCommissionerStatus("proving_marked_done")?.tone).toBe("success");
    expect(renderCommissionerStatus("proving_done")).toMatchObject({ tone: "danger" });
    expect(renderCommissionerStatus("proving_done")?.body).toContain("proving is marked done");
  });

  it("says a request held for an earlier credit needs the commissioner's amount first", () => {
    expect(renderCommissionerStatus("override_needed")).toMatchObject({ tone: "danger" });
    expect(renderCommissionerStatus("override_needed")?.body).toContain("override");
  });

  it("confirms an acknowledged alert and a switch of automation, and says when nothing changed", () => {
    expect(renderCommissionerStatus("acknowledged")?.tone).toBe("success");
    expect(renderCommissionerStatus("alert_not_found")?.tone).toBe("danger");
    expect(renderCommissionerStatus("automation_switched_off")?.body).toContain(
      "Nothing more goes to ESPN"
    );
    expect(renderCommissionerStatus("automation_switched_on")?.tone).toBe("success");
    expect(renderCommissionerStatus("automation_unchanged")?.tone).toBe("danger");
  });

  it("says when another tab acted first, and that nothing from this one was applied", () => {
    expect(renderCommissionerStatus("changed")).toEqual({
      body: "This request changed in another tab or by InjurySub. What you see now is current; nothing from this tab was applied.",
      tone: "danger",
    });
  });

  // A filing on a team's behalf is answered in the filing form's own words (filing-copy).
  it("explains any refusal a manager could get", () => {
    expect(renderCommissionerStatus("not_out")?.body).toBe("Player is no longer listed as OUT.");
  });

  it("shows nothing for no status, an unknown one, or an object's own property names", () => {
    for (const status of [null, "not_a_status", "__proto__", "hasOwnProperty"]) {
      expect(renderCommissionerStatus(status)).toBeNull();
    }
  });
});
