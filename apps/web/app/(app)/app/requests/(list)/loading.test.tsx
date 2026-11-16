import { describe, expect, it } from "vitest";
import { elementsWithClass, renderMarkup } from "../../../../../components/test-support";
import RequestsLoading from "./loading";

// IF-LIST-2: placeholders the size of real rows, so the rows don't shift the page when they come.
// A real row (RequestRow) is a "reqrow has-faces" grid: the face pair spanning the title and the
// pill's line, the amount beside the title.
describe("the Requests list's loading state", () => {
  it("draws each placeholder row as a real row is laid out, faces included", () => {
    const html = renderMarkup(<RequestsLoading />);

    expect(elementsWithClass(html, "list-panel")[0]?.attributes["aria-busy"]).toBe("true");
    expect(elementsWithClass(html, "reqrow", "has-faces")).toHaveLength(4);
    expect(elementsWithClass(html, "face-pair")).toHaveLength(4);
    expect(elementsWithClass(html, "line2")).toHaveLength(4);
  });
});
