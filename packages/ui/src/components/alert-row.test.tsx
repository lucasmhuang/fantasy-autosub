import { describe, expect, it } from "vitest";
import { elementsWithClass, renderMarkup, textOf } from "../test-support";
import { AlertRow } from "./alert-row";

describe("AlertRow", () => {
  it("says what changed, when, each move with its face, and how to undo it, with its action", () => {
    const html = renderMarkup(
      <AlertRow
        title="Lineup change on Stretch Fours"
        when="On ESPN Wed 3:12 PM PT · seen 3:13 PM PT"
        what="A league-manager edit InjurySub didn't make:"
        moves={[
          { text: "Mathurin BN → F", team: "NO", face: null },
          { text: "Siakam F → BN", team: "IND", face: null, out: true },
        ]}
        undo={
          <>
            <b>To undo:</b> as league manager, move Mathurin F → BN and Siakam BN → F for Wed Nov
            11.
          </>
        }
        action={<button type="submit">Acknowledge</button>}
      />
    );

    expect(elementsWithClass(html, "qrow", "alert-row")).toHaveLength(1);
    expect(elementsWithClass(html, "what")).toHaveLength(1);
    expect(elementsWithClass(html, "move")).toHaveLength(2);
    expect(elementsWithClass(html, "undo")).toHaveLength(1);
    expect(textOf(html)).toBe(
      "Lineup change on Stretch FoursOn ESPN Wed 3:12 PM PT · seen 3:13 PM PTAcknowledgeA league-manager edit InjurySub didn't make:Mathurin BN → FSiakam F → BNTo undo: as league manager, move Mathurin F → BN and Siakam BN → F for Wed Nov 11."
    );
  });

  it("leaves out the moves and the undo line when an alert has none", () => {
    const html = renderMarkup(
      <AlertRow
        title="The league turned public"
        when="Seen Wed 3:13 PM PT"
        what="Anyone with the league ID can read members' names."
        action={<span>Acknowledged Thu 9:10 AM PT</span>}
      />
    );

    expect(elementsWithClass(html, "moves")).toEqual([]);
    expect(elementsWithClass(html, "undo")).toEqual([]);
  });
});
