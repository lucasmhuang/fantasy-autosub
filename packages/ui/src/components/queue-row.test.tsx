import { describe, expect, it } from "vitest";
import { elementsByTag, elementsWithClass, renderMarkup, textOf } from "../test-support";
import { QueueRow } from "./queue-row";

const ROW = {
  team: "Stretch Fours",
  swap: "Mathurin in for Siakam",
  incoming: { team: "NO", face: null },
  outgoing: { team: "IND", face: null },
  when: "Wed 6:10 PM PT",
  amount: "−22.6 proj.",
  href: "/commish/requests/9",
};

describe("QueueRow", () => {
  it("leads with the faces, then team and amount, then the swap with its time", () => {
    const html = renderMarkup(<QueueRow {...ROW} status={{ kind: "in-line", word: "In line" }} />);

    expect(elementsWithClass(html, "qrow", "has-faces")[0]).toEqual({
      tag: "a",
      attributes: { class: "qrow has-faces", href: "/commish/requests/9" },
    });
    expect(elementsWithClass(html, "swap")).toHaveLength(1);
    expect(elementsWithClass(html, "swap", "ellipsis")).toEqual([]);
    expect(textOf(html)).toBe(
      "Stretch Fours−22.6 proj.Mathurin in for SiakamWed 6:10 PM PTIn line"
    );
  });

  it("says why a request needs the commissioner, in a pill and one sentence", () => {
    const html = renderMarkup(
      <QueueRow
        {...ROW}
        needs={{
          reason: "Suspension",
          sentence: "Siakam is suspended, not OUT. Approve or settle by hand.",
        }}
      />
    );

    expect(elementsWithClass(html, "why")).toHaveLength(1);
    expect(elementsWithClass(html, "status-line")).toEqual([]);
    expect(elementsWithClass(html, "pill", "pill-wait")).toHaveLength(1);
    expect(textOf(html)).toContain(
      "SuspensionSiakam is suspended, not OUT. Approve or settle by hand."
    );
  });

  it("draws a misuse alert with the alert mark where a request's faces go", () => {
    const { incoming: _in, outgoing: _out, ...common } = ROW;
    const html = renderMarkup(
      <QueueRow
        {...common}
        alert
        team="Misuse watch"
        swap="A lineup change on Stretch Fours InjurySub didn't make"
        amount="—"
        href="/commish/alerts"
        needs={{ reason: "Alert", sentence: "Acknowledge it, or undo it on ESPN." }}
      />
    );

    expect(elementsWithClass(html, "face-pair", "queue-alert-mark")).toHaveLength(1);
    expect(elementsWithClass(html, "face-s")).toEqual([]);
    expect(elementsByTag(html, "svg")[0]?.attributes["aria-hidden"]).toBe("true");
    expect(elementsWithClass(html, "qrow")[0]?.attributes.href).toBe("/commish/alerts");
    expect(textOf(html)).toBe(
      "Misuse watch—A lineup change on Stretch Fours InjurySub didn't makeWed 6:10 PM PTAlertAcknowledge it, or undo it on ESPN."
    );
  });

  it("marks the request open beside the queue", () => {
    const open = renderMarkup(
      <QueueRow {...ROW} current status={{ kind: "done", word: "Done by you" }} />
    );
    const closed = renderMarkup(
      <QueueRow {...ROW} status={{ kind: "done", word: "Done by you" }} />
    );

    expect(elementsWithClass(open, "qrow")[0]?.attributes["aria-current"]).toBe("true");
    expect(elementsWithClass(closed, "qrow")[0]?.attributes["aria-current"]).toBeUndefined();
  });
});
