import { describe, expect, it } from "vitest";
import { renderMarkup } from "../test-support";
import { freshText } from "./fresh-text";
import { FreshTime } from "./fresh-time";

const at = "2026-11-17T21:10:00.000Z";

// FS-TIME-8: a freshness line shows the data's age, kept current by the browser.
describe("a freshness time", () => {
  it("renders the server's time first, with the instant and the time to hover", () => {
    const html = renderMarkup(<FreshTime at={at} time="1:10 PM PT" />);

    expect(html).toMatch(/<time[^>]*datetime="2026-11-17T21:10:00.000Z"[^>]*>1:10 PM PT<\/time>/i);
    expect(html).toMatch(/title="1:10 PM PT"/);
  });

  it("reads as an age once the browser has its own clock", () => {
    expect(freshText(at, new Date("2026-11-17T21:14:30.000Z"), "1:10 PM PT")).toBe("4 min ago");
  });

  it("goes back to the time once the age stops helping", () => {
    expect(freshText(at, new Date("2026-11-18T09:10:00.000Z"), "Tue 1:10 PM PT")).toBe(
      "Tue 1:10 PM PT"
    );
  });
});
