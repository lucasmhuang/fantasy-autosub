import { describe, expect, it } from "vitest";
import { describeEdit, editLines, formatNextGame, formatReadTime } from "./format";

describe("formatNextGame", () => {
  it("names an evening game by its Pacific day, though its UTC date is the next day", () => {
    const game = { date: "2026-10-29T00:00:00.000Z", opponent: "BOS", home: true };

    expect(formatNextGame(game)).toBe("Wed 5:00 PM PT vs BOS");
  });

  it("marks an away game", () => {
    const game = { date: "2026-11-04T03:30:00.000Z", opponent: "DEN", home: false };

    expect(formatNextGame(game)).toBe("Tue 7:30 PM PT @ DEN");
  });

  it("says when there's no game ahead", () => {
    expect(formatNextGame(null)).toBe("No game scheduled");
  });
});

describe("formatReadTime", () => {
  it("gives the read's time in Pacific", () => {
    expect(formatReadTime("2026-11-06T02:05:00.000Z")).toBe("Thu 6:05 PM PT");
  });
});

describe("describeEdit", () => {
  const lillardOut = { playerId: 1, name: "Damian Lillard", fromSlot: "G", toSlot: "BE" };

  it("names the other starter's move, then where the replacement goes", () => {
    const edit = {
      items: [
        lillardOut,
        { playerId: 2, name: "Bam Adebayo", fromSlot: "UTIL", toSlot: "G" },
        { playerId: 3, name: "Zach Edey", fromSlot: "BE", toSlot: "UTIL" },
      ],
      movedStarters: 1,
    };

    expect(describeEdit(edit)).toBe("Bam Adebayo moves to G; Zach Edey takes UTIL");
  });

  it("says when the replacement takes an open starting slot, with nobody moving", () => {
    const edit = {
      items: [lillardOut, { playerId: 3, name: "Zach Edey", fromSlot: "BE", toSlot: "UTIL" }],
      movedStarters: 0,
    };

    expect(describeEdit(edit)).toBe("Zach Edey takes the open UTIL");
  });

  it("adds nothing for a direct swap, which takes the injured starter's slot", () => {
    const edit = {
      items: [lillardOut, { playerId: 4, name: "Jeremiah Fears", fromSlot: "BE", toSlot: "G" }],
      movedStarters: 0,
    };

    expect(describeEdit(edit)).toBeNull();
  });
});

describe("editLines", () => {
  it("lists every change in a one-move edit, saying the moved starter's points are unaffected", () => {
    const edit = {
      items: [
        { playerId: 1, name: "Damian Lillard", fromSlot: "G", toSlot: "BE" },
        { playerId: 2, name: "Bam Adebayo", fromSlot: "UTIL", toSlot: "G" },
        { playerId: 3, name: "Zach Edey", fromSlot: "BE", toSlot: "UTIL" },
      ],
      movedStarters: 1,
    };

    expect(editLines(edit)).toEqual({
      changes: [
        "Damian Lillard leaves G for the bench.",
        "Bam Adebayo moves from UTIL to G.",
        "Zach Edey comes off the bench into UTIL.",
      ],
      unaffected: "Bam Adebayo's points are unaffected: only his slot changes.",
    });
  });

  it("says nothing about other starters when none moves", () => {
    const edit = {
      items: [
        { playerId: 1, name: "Damian Lillard", fromSlot: "G", toSlot: "BE" },
        { playerId: 4, name: "Jeremiah Fears", fromSlot: "BE", toSlot: "G" },
      ],
      movedStarters: 0,
    };

    expect(editLines(edit)).toEqual({
      changes: [
        "Damian Lillard leaves G for the bench.",
        "Jeremiah Fears comes off the bench into G.",
      ],
      unaffected: null,
    });
  });
});
