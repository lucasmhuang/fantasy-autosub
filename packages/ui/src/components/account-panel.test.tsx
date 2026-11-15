import { describe, expect, it } from "vitest";
import { elementsByTag, elementsWithClass, renderMarkup, textOf } from "../test-support";
import { AccountPanel } from "./account-panel";

describe("AccountPanel", () => {
  it("opens from the account control, named for what it does", () => {
    const html = renderMarkup(<AccountPanel initial="D" email="dana@example.com" team="Team 7" />);

    expect(elementsByTag(html, "details")).toHaveLength(1);
    expect(elementsByTag(html, "summary")[0]?.attributes).toMatchObject({
      "aria-label": "Account and sign out",
    });
    expect(elementsWithClass(html, "acct")[0]?.tag).toBe("summary");
  });

  it("says who is signed in and for which team, and signs out this device only", () => {
    const html = renderMarkup(<AccountPanel initial="D" email="dana@example.com" team="Team 7" />);

    expect(textOf(html)).toBe("DSigned in asdana@example.comTeamTeam 7Sign out on this device");
    expect(elementsByTag(html, "form")).toEqual([
      { tag: "form", attributes: { method: "post", action: "/logout" } },
    ]);
    expect(elementsWithClass(html, "btn-sec")[0]?.attributes.type).toBe("submit");
  });

  it("leaves the team out for an account with none", () => {
    const html = renderMarkup(<AccountPanel initial="S" email="sam@example.com" />);

    expect(textOf(html)).toBe("SSigned in assam@example.comSign out on this device");
  });
});
