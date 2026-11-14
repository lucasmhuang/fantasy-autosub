import { describe, expect, it } from "vitest";
import { renderCommissionerStatus } from "./status-messages";

describe("renderCommissionerStatus", () => {
  it("confirms a manual completion", () => {
    expect(renderCommissionerStatus("completed_manually")).toEqual({
      body: "Recorded as completed by hand.",
      tone: "success",
    });
  });

  it("confirms an approval, and says why one was refused", () => {
    expect(renderCommissionerStatus("approved")?.tone).toBe("success");
    expect(renderCommissionerStatus("reapproved")?.tone).toBe("success");
    expect(renderCommissionerStatus("amount_changed")).toEqual({
      body: "The adjustment changed while you were looking, so nothing was approved. Here is the amount now.",
      tone: "danger",
    });
    expect(renderCommissionerStatus("week_ended")?.body).toContain("by hand");
    expect(renderCommissionerStatus("automation_off")?.body).toContain("Automation is off");
    expect(renderCommissionerStatus("not_allowlisted")?.body).toContain("this team");
  });

  it("confirms a proving filing, a cancel and proving marked done, and says when filing is closed", () => {
    expect(renderCommissionerStatus("proving_filed")?.tone).toBe("success");
    expect(renderCommissionerStatus("cancelled")?.tone).toBe("success");
    expect(renderCommissionerStatus("proving_marked_done")?.tone).toBe("success");
    expect(renderCommissionerStatus("proving_done")).toMatchObject({ tone: "danger" });
    expect(renderCommissionerStatus("proving_done")?.body).toContain("proving is marked done");
  });

  it("says when another tab acted first", () => {
    expect(renderCommissionerStatus("changed")?.tone).toBe("danger");
  });

  it("says when the settings changed in another tab, and nothing was saved", () => {
    expect(renderCommissionerStatus("settings_changed")).toEqual({
      body: "The settings changed while you were looking, so nothing was saved. Here they are now.",
      tone: "danger",
    });
  });

  it("explains an on-behalf refusal, and any refusal a manager could get", () => {
    expect(renderCommissionerStatus("game_had_started")?.body).toBe(
      "Refused: the replacement's game had already started at that moment."
    );
    expect(renderCommissionerStatus("not_out")?.body).toBe("Player is no longer listed as OUT.");
  });

  it("shows nothing for no status, an unknown one, or an object's own property names", () => {
    for (const status of [null, "not_a_status", "__proto__", "hasOwnProperty"]) {
      expect(renderCommissionerStatus(status)).toBeNull();
    }
  });
});
