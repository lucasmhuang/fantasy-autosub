import { describe, expect, it } from "vitest";
import type { BoardEdit } from "../../lib/server/board";
import {
  adjustmentKind,
  afterYouConfirm,
  confirmButtonLabel,
  confirmRoute,
  confirmSubtitle,
  lineupChangeRows,
} from "./confirm-copy";

const edit = (items: [string, string, string][]): BoardEdit => ({
  items: items.map(([name, fromSlot, toSlot], index) => ({
    playerId: index,
    name,
    fromSlot,
    toSlot,
  })),
  movedStarters: Math.max(0, items.length - 2),
});

const DIRECT = edit([
  ["Joel Embiid", "C", "BE"],
  ["Naz Reid", "BE", "C"],
]);
const ONE_MOVE = edit([
  ["Joel Embiid", "C", "BE"],
  ["Bam Adebayo", "F/C", "C"],
  ["Keegan Murray", "BE", "F/C"],
]);
const OPEN_ELSEWHERE = edit([
  ["Devin Booker", "G", "BE"],
  ["Keegan Murray", "BE", "UTIL"],
]);
const TWO_MOVES = edit([
  ["Joel Embiid", "C", "BE"],
  ["Bam Adebayo", "F/C", "C"],
  ["Lauri Markkanen", "UTIL", "F/C"],
  ["Coby White", "BE", "UTIL"],
]);

describe("confirmRoute", () => {
  it("goes as the league routes a Ready option, and to the commissioner otherwise", () => {
    expect(confirmRoute("ready_now", "now")).toBe("now");
    expect(confirmRoute("ready_now", "approval")).toBe("approval");
    expect(confirmRoute("ready_now", "commissioner")).toBe("off");
    expect(confirmRoute("review_required", "now")).toBe("review");
  });
});

describe("confirmSubtitle", () => {
  it("says how it goes and what kind of swap it is", () => {
    expect(confirmSubtitle("now", DIRECT, "Sam")).toBe("Ready now · a straight swap into C");
    expect(confirmSubtitle("now", ONE_MOVE, "Sam")).toBe(
      "Ready now · Bam Adebayo moves to C to make room"
    );
    expect(confirmSubtitle("now", OPEN_ELSEWHERE, "Sam")).toBe("Ready now · takes the open UTIL");
    expect(confirmSubtitle("approval", DIRECT, "Sam")).toBe(
      "Ready once Sam approves · a straight swap into C"
    );
    expect(confirmSubtitle("off", DIRECT, "Sam")).toBe("Sam makes it · a straight swap into C");
    expect(confirmSubtitle("review", TWO_MOVES, "Sam")).toBe(
      "Sam decides · two other starters would move"
    );
  });
});

describe("confirmButtonLabel", () => {
  it("names the action and the amount", () => {
    expect(confirmButtonLabel("now", "−87.8", "Sam")).toBe("Confirm swap · −87.8");
    expect(confirmButtonLabel("approval", "−87.8", "Sam")).toBe("Send for approval · −87.8");
    expect(confirmButtonLabel("off", "−87.8", "Sam")).toBe("Send to Sam · −87.8");
    expect(confirmButtonLabel("review", "−103.1", "Sam")).toBe("Send to Sam · −103.1");
  });
});

describe("afterYouConfirm", () => {
  const base = { amount: "−87.8", owed: true, rulesHeld: false };

  it("says what happens on ESPN for each route and swap", () => {
    expect(afterYouConfirm({ ...base, route: "now", edit: DIRECT }, "Sam")).toBe(
      "Reid moves to C, Embiid to the bench, and −87.8 posts on ESPN, usually within a minute. If anything doesn't match, Sam takes over."
    );
    expect(afterYouConfirm({ ...base, amount: "−82.1", route: "now", edit: ONE_MOVE }, "Sam")).toBe(
      "Murray takes F/C, Adebayo moves to C, Embiid goes to the bench, and −82.1 posts on ESPN, usually within a minute. If anything doesn't match, Sam takes over."
    );
    expect(
      afterYouConfirm({ ...base, amount: "−54.4", route: "now", edit: OPEN_ELSEWHERE }, "Sam")
    ).toBe(
      "Murray moves into UTIL, Booker to the bench, and −54.4 posts on ESPN, usually within a minute. If anything doesn't match, Sam takes over."
    );
    expect(afterYouConfirm({ ...base, route: "approval", edit: DIRECT }, "Sam")).toBe(
      "Nothing changes on ESPN until Sam approves. Reid's points count from now either way."
    );
    expect(afterYouConfirm({ ...base, route: "off", edit: DIRECT }, "Sam")).toBe(
      "Sam makes this swap on ESPN by hand. Reid's points count from now."
    );
    expect(afterYouConfirm({ ...base, route: "review", edit: TWO_MOVES }, "Sam")).toBe(
      "Sam makes these moves on ESPN by hand. White's points count from now, however long that takes."
    );
  });

  it("says less when nothing is owed or the adjustment waits on the rules", () => {
    expect(afterYouConfirm({ ...base, owed: false, route: "now", edit: DIRECT }, "Sam")).toBe(
      "The swap goes to ESPN, usually within a minute."
    );
    expect(afterYouConfirm({ ...base, rulesHeld: true, route: "now", edit: DIRECT }, "Sam")).toBe(
      "The swap runs now, usually within a minute."
    );
  });
});

describe("lineupChangeRows", () => {
  it("lists a rearrangement's moves, the replacement, then the starter to the bench", () => {
    expect(lineupChangeRows(ONE_MOVE, false)).toEqual([
      {
        playerId: 1,
        slot: "C",
        name: "Bam Adebayo",
        text: "Moves from F/C. His points count either way.",
        bench: false,
      },
      {
        playerId: 2,
        slot: "F/C",
        name: "Keegan Murray",
        text: "Comes off the bench.",
        bench: false,
      },
      { playerId: 0, slot: "BN", name: "Joel Embiid", text: "Goes to the bench.", bench: true },
    ]);
    expect(lineupChangeRows(OPEN_ELSEWHERE, false)[0]?.text).toBe(
      "Comes off the bench into the open UTIL."
    );
    expect(lineupChangeRows(TWO_MOVES, true)[0]?.text).toBe("Moves from F/C.");
  });

  it("lists none for a straight swap", () => {
    expect(lineupChangeRows(DIRECT, false)).toEqual([]);
  });
});

describe("adjustmentKind", () => {
  it("maps every projection line to the panel's kind", () => {
    expect(adjustmentKind("injured_credited_before_swap")).toBe("start");
    expect(adjustmentKind("earlier_credit_forfeited")).toBe("credit");
    expect(adjustmentKind("replacement_after_request")).toBe("after");
    expect(adjustmentKind("replacement_on_bench")).toBe("bench");
    expect(adjustmentKind("replacement_before_request")).toBe("before");
  });
});
