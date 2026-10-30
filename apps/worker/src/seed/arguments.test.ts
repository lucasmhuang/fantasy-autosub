import { describe, expect, it } from "vitest";
import { parseSeedArguments } from "./arguments";

describe("parseSeedArguments", () => {
  it("takes a path alone as a dry run", () => {
    expect(parseSeedArguments(["/abs/accounts.csv"])).toEqual({
      ok: true,
      filePath: "/abs/accounts.csv",
      apply: false,
    });
  });

  it("takes --apply on either side of the path", () => {
    const applied = { ok: true, filePath: "/abs/accounts.csv", apply: true };

    expect(parseSeedArguments(["/abs/accounts.csv", "--apply"])).toEqual(applied);
    expect(parseSeedArguments(["--apply", "/abs/accounts.csv"])).toEqual(applied);
  });

  it("refuses no path, two paths, a misspelled flag, or --apply twice, counting what it didn't know", () => {
    expect(parseSeedArguments([])).toEqual({ ok: false, pathGiven: false, unknownArgCount: 0 });
    expect(parseSeedArguments(["--apply"])).toEqual({
      ok: false,
      pathGiven: false,
      unknownArgCount: 0,
    });
    expect(parseSeedArguments(["/a.csv", "/b.csv"])).toEqual({
      ok: false,
      pathGiven: true,
      unknownArgCount: 1,
    });
    expect(parseSeedArguments(["/a.csv", "--aply"])).toEqual({
      ok: false,
      pathGiven: true,
      unknownArgCount: 1,
    });
    expect(parseSeedArguments(["/a.csv", "--apply", "--apply"])).toEqual({
      ok: false,
      pathGiven: true,
      unknownArgCount: 1,
    });
  });
});
