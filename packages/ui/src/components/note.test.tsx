import { describe, expect, it } from "vitest";
import { elementsWithClass, renderMarkup, textOf } from "../test-support";
import { Note, type NoteKind } from "./note";

// Each kind's glyph, by the first path of the system's icon.
const KINDS: [NoteKind, string][] = [
  ["warn", 'd="M12 3.5l9 16h-18z"'],
  ["move", 'd="M7 4v14"'],
  ["review", 'd="M12 7.5V12l3 2"'],
  ["stop", 'd="M6.5 6.5l11 11"'],
  ["taken", 'd="M12 8v4.5"'],
];

describe("Note", () => {
  it.each(KINDS)("shows a %s note in its tones, with its glyph", (kind, glyph) => {
    const html = renderMarkup(<Note kind={kind}>No games left this week.</Note>);

    expect(elementsWithClass(html, "note", `note-${kind}`)).toHaveLength(1);
    expect(html).toContain(glyph);
    expect(textOf(html)).toBe("No games left this week.");
  });
});
