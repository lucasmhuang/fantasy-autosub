import { describe, expect, it } from "vitest";
import { renderMarkup } from "../test-support";
import { Button } from "./button";

describe("Button", () => {
  it("renders a button with its text and type", () => {
    const markup = renderMarkup(<Button type="submit">Save</Button>);

    expect(markup).toMatch(/^<button [^>]*type="submit"[^>]*>Save<\/button>$/);
  });
});
