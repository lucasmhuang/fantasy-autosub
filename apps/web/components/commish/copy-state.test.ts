import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyValue } from "./copy-state";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function recorder() {
  const labels: string[] = [];
  return { labels, show: (label: string) => labels.push(label) };
}

// IF-DETAIL-10: "Copy" reads "Copied" for 1.5 seconds, then "Copy" again.
describe("copyValue", () => {
  it("puts the value on the clipboard and says Copied for 1.5 seconds", async () => {
    const written: string[] = [];
    const { labels, show } = recorder();

    await copyValue("−31.4", { write: async (text) => void written.push(text), show });
    expect(written).toEqual(["−31.4"]);
    expect(labels).toEqual(["Copied"]);

    vi.advanceTimersByTime(1499);
    expect(labels).toEqual(["Copied"]);
    vi.advanceTimersByTime(1);
    expect(labels).toEqual(["Copied", "Copy"]);
  });

  it("says it can't copy when the browser refuses the clipboard, then Copy again", async () => {
    const { labels, show } = recorder();
    const refuse = async () => {
      throw new DOMException("Write permission denied.", "NotAllowedError");
    };

    await copyValue("−31.4", { write: refuse, show });
    vi.advanceTimersByTime(1500);

    expect(labels).toEqual(["Can't copy", "Copy"]);
  });
});
