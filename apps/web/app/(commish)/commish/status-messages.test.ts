import { describe, expect, it } from "vitest";
import { renderCommissionerStatus } from "./status-messages";

describe("renderCommissionerStatus", () => {
  it("confirms a manual completion", () => {
    expect(renderCommissionerStatus("completed_manually")).toEqual({
      body: "Recorded as completed by hand.",
      tone: "success",
    });
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
