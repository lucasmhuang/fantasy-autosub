import { describe, expect, it } from "vitest";
import { elementsWithClass, renderMarkup, textOf } from "../test-support";
import { RequestRow } from "./request-row";

const ROW = {
  title: "Kessler in for Adebayo",
  incoming: { team: "UTAH", face: null },
  outgoing: { team: "MIA", face: null },
  amount: "−22.6",
  status: { kind: "done" as const, word: "Done" },
  when: "Wed Nov 4, 8:12 PM PT · week 3",
  href: "/app/requests/7",
};

describe("RequestRow", () => {
  it("links the whole row to the request, the face pair leading", () => {
    const html = renderMarkup(<RequestRow {...ROW} />);

    expect(elementsWithClass(html, "reqrow", "has-faces")).toEqual([
      { tag: "a", attributes: { class: "reqrow has-faces", href: "/app/requests/7" } },
    ]);
    expect(elementsWithClass(html, "face-pair")).toHaveLength(1);
  });

  it("gives every row the same three lines: who and the amount, the status, then when", () => {
    const html = renderMarkup(<RequestRow {...ROW} />);

    expect(elementsWithClass(html, "title", "ellipsis")).toHaveLength(1);
    expect(elementsWithClass(html, "t-amount")).toHaveLength(1);
    expect(elementsWithClass(html, "line2")).toHaveLength(1);
    expect(elementsWithClass(html, "pill", "pill-ok")).toHaveLength(1);
    expect(textOf(html)).toBe("Kessler in for Adebayo−22.6DoneWed Nov 4, 8:12 PM PT · week 3");
  });
});
