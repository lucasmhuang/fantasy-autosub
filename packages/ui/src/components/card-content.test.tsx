import { describe, expect, it } from "vitest";
import { renderMarkup } from "../test-support";
import { BoardRow } from "./board-row";
import { CardStage } from "./card-stage";
import { OptionCard } from "./option-card";
import { OutCard } from "./out-card";
import { PlayerCard } from "./player-card";

// The owner's rule (FS-BOARD-19): no card shows a lineup lock or a derived rating.
describe("the cards", () => {
  it("show no lineup lock and no rating anywhere", () => {
    const face = { src: "/faces/reid.png" };
    const markup = [
      <BoardRow
        key="row"
        slot="C"
        name="Naz Reid"
        team="MIN"
        logo="/l.png"
        face={face}
        meta="MIN · next Thu"
        weekPoints="1.0"
        average="2.0"
        live
      />,
      <OutCard
        key="out"
        name="Joel Embiid"
        slot="C"
        face={face}
        teamLine="PHI · C"
        nextGame="Next game Thu"
        forfeit="82.1"
        days={["Mon 46.5"]}
        games="1 game"
        stats={[{ label: "PTS", value: "44" }]}
      >
        x
      </OutCard>,
      <OptionCard
        key="option"
        name="Naz Reid"
        team="MIN"
        positions="C"
        face={face}
        average="31.2"
        gamesLeft="3"
        gameDays="Wed"
        next="Wed"
        href="/c"
        label="Naz Reid, ready now"
      />,
      <PlayerCard
        key="card"
        size="m"
        surname="Reid"
        team="MIN"
        logo="/l.png"
        face={face}
        number="31.2"
        numberLabel="Season avg"
        fact="C · MIN"
      />,
      <CardStage
        key="stage"
        incoming={{
          name: "Naz Reid",
          surname: "Reid",
          slot: "C",
          team: "MIN",
          face,
          average: "31.2",
        }}
        outgoing={{ name: "Joel Embiid", surname: "Embiid", team: "PHI", face }}
        done
      />,
    ]
      .map((element) => renderMarkup(element))
      .join("");

    expect(markup.length).toBeGreaterThan(2000);
    expect(markup).not.toMatch(/lock|rating/i);
  });
});
