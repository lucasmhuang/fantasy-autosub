import { describe, expect, it } from "vitest";
import { elementsByTag, elementsWithClass, renderMarkup, textOf } from "../test-support";
import { ReadBack, StatusPanel, Tracker } from "./request-status";

describe("StatusPanel", () => {
  it("says the status, who acts next and one sentence, read out politely as it changes", () => {
    const html = renderMarkup(
      <StatusPanel
        tone="busy"
        word="In progress"
        who="InjurySub"
        sentence="Sending the lineup edit to ESPN."
        live
      />
    );

    expect(elementsWithClass(html, "status", "is-busy")[0]?.attributes).toEqual({
      class: "status is-busy",
      "aria-live": "polite",
      "aria-label": "Status",
    });
    expect(textOf(html)).toBe("In progressInjurySubSending the lineup edit to ESPN.");
  });

  it("draws no who or sentence where the state says it all", () => {
    const html = renderMarkup(<StatusPanel tone="busy" word="In line" who="" sentence="" />);

    expect(elementsWithClass(html, "who")).toEqual([]);
    expect(elementsByTag(html, "p")).toEqual([]);
    expect(textOf(html)).toBe("In line");
  });

  it("is quiet once the request has settled", () => {
    const html = renderMarkup(<StatusPanel tone="ok" word="Done" who="ESPN confirmed" />);

    expect(elementsWithClass(html, "status", "is-ok")[0]?.attributes["aria-live"]).toBeUndefined();
    expect(elementsByTag(html, "p")).toEqual([]);
  });
});

describe("Tracker", () => {
  const STEPS = [
    { label: "Checked", state: "done", note: "6:41 PM PT" },
    { label: "Lineup", state: "done", note: "6:41 PM PT" },
    { label: "Adjustment", state: "active", note: "sent 6:42 PM PT" },
    { label: "Done", state: "todo", note: "–" },
  ] as const;

  it("shows the four steps, each with its time, the rail reaching the active step", () => {
    const html = renderMarkup(<Tracker steps={[...STEPS]} />);

    expect(elementsWithClass(html, "tracker")[0]?.attributes["aria-label"]).toBe(
      "Progress on ESPN"
    );
    expect(elementsWithClass(html, "step-dot").map(({ attributes }) => attributes.class)).toEqual([
      "step-dot done",
      "step-dot done",
      "step-dot active",
      "step-dot todo",
    ]);
    expect(elementsWithClass(html, "fill")[0]?.attributes.style).toBe("width:50%");
    expect(textOf(html)).toBe("Checked6:41 PM PTLineup6:41 PM PTAdjustmentsent 6:42 PM PTDone–");
  });

  it("marks a held step with ! and a skipped one with a dash, and draws no rail before any", () => {
    const held = renderMarkup(
      <Tracker
        steps={[
          { label: "Checked", state: "done", note: "6:41 PM PT" },
          { label: "Lineup", state: "held", note: "held" },
          { label: "Adjustment", state: "skip", note: "not owed" },
          { label: "Done", state: "todo", note: "–" },
        ]}
      />
    );
    const none = renderMarkup(
      <Tracker steps={STEPS.map((step) => ({ ...step, state: "todo" as const }))} />
    );

    expect(textOf(held)).toContain("!Lineupheld–Adjustmentnot owed");
    expect(elementsWithClass(held, "fill")[0]?.attributes.style).toBe("width:25%");
    expect(elementsWithClass(none, "fill")).toEqual([]);
  });
});

describe("ReadBack", () => {
  it("lists each ESPN write with what ESPN showed, and when", () => {
    const html = renderMarkup(
      <ReadBack
        title="What ESPN shows now"
        lines={[
          { kind: "ok", text: "Reid at C, Embiid on the bench", when: "On ESPN Wed 6:41 PM PT" },
          { kind: "waiting", text: "Adjustment −87.8 sent", when: "Waiting for ESPN" },
          { kind: "fail", text: "ESPN refused the lineup edit.", when: "Wed 6:42 PM PT" },
        ]}
      />
    );

    expect(elementsWithClass(html, "t-label")[0]?.tag).toBe("h2");
    expect(elementsWithClass(html, "rb").map(({ attributes }) => attributes.class)).toEqual([
      "rb",
      "rb",
      "rb is-fail",
    ]);
    expect(elementsWithClass(html, "spin")[0]?.attributes["aria-hidden"]).toBe("true");
    expect(textOf(html)).toBe(
      "What ESPN shows nowReid at C, Embiid on the benchOn ESPN Wed 6:41 PM PTAdjustment −87.8 sentWaiting for ESPNESPN refused the lineup edit.Wed 6:42 PM PT"
    );
  });
});
