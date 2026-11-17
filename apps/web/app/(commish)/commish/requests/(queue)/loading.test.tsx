import { describe, expect, it } from "vitest";
import { elementsWithClass, renderMarkup } from "../../../../../components/test-support";
import QueueLoading from "./loading";

// Placeholders the shape of real queue rows (QueueRow): the face pair spanning the team line and
// the swap's line, then the pill's line, so the rows don't shift the page when they come.
describe("the queue's loading state", () => {
  it("draws each placeholder row as a queue row is laid out, faces and pill line included", () => {
    const html = renderMarkup(<QueueLoading />);

    expect(elementsWithClass(html, "list-panel")[0]?.attributes["aria-busy"]).toBe("true");
    expect(elementsWithClass(html, "qrow", "has-faces")).toHaveLength(4);
    expect(elementsWithClass(html, "face-pair")).toHaveLength(4);
    expect(elementsWithClass(html, "line2")).toHaveLength(4);
    expect(elementsWithClass(html, "why")).toHaveLength(4);
  });
});
