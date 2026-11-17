import { describe, expect, it } from "vitest";
import { outcomeOf, picksOf, showsPoints } from "./filing-state";

const json = (body: unknown) => ({
  redirected: false,
  url: "http://localhost:3000/commish/requests/file",
  contentType: "application/json",
  body,
});

describe("what the filing form does with the route's answer", () => {
  it("goes to a filed request", () => {
    expect(outcomeOf(json({ status: "recorded", location: "/commish/requests/abc" }))).toEqual({
      kind: "navigate",
      to: "/commish/requests/abc",
    });
  });

  it("shows each problem at its field and the whole form's refusal, counting the answers", () => {
    expect(
      outcomeOf(
        json({
          status: "not_filed",
          errors: [
            { field: "enteredPoints", code: "out_of_range", limitTenths: 180 },
            { field: "note", code: "missing" },
          ],
          refusal: "active_request_exists",
        })
      )
    ).toEqual({
      kind: "problems",
      errors: {
        enteredPoints: { field: "enteredPoints", code: "out_of_range", limitTenths: 180 },
        note: { field: "note", code: "missing" },
      },
      refusal: "active_request_exists",
      count: 2,
    });
  });

  it("shows a status the route answered with as a notice", () => {
    expect(outcomeOf(json({ status: "espn_unreachable" }))).toEqual({
      kind: "notice",
      status: "espn_unreachable",
    });
  });

  // Signed out, the guard's redirect lands on the sign-in page: go there.
  it("follows a redirect the route answered with", () => {
    expect(
      outcomeOf({
        redirected: true,
        url: "http://localhost:3000/login?redirect=%2Fcommish%2Frequests%2Fnew",
        contentType: "text/html",
        body: null,
      })
    ).toEqual({
      kind: "navigate",
      to: "http://localhost:3000/login?redirect=%2Fcommish%2Frequests%2Fnew",
    });
  });

  it.for([
    ["text/plain", "Only the commissioner can do this."],
    ["application/json", { status: "not_filed", errors: [{ field: "elsewhere", code: "x" }] }],
    ["application/json", { status: "something_new" }],
  ] as const)("treats an answer it can't read (%s) as a failure on our side", ([type, body]) => {
    expect(outcomeOf({ redirected: false, url: "", contentType: type, body })).toEqual({
      kind: "notice",
      status: "unavailable",
    });
  });
});

describe("the filing form's picks", () => {
  it("reads the picks from the form", () => {
    const form = new FormData();
    form.set("injured", "6606");
    form.set("day", "2026-11-11");
    form.set("replacementGame", "in_progress");

    expect(picksOf(form)).toEqual({
      injured: "6606",
      replacement: null,
      day: "2026-11-11",
      game: "in_progress",
    });
  });

  it("shows the points and the note only for a game in progress (IF-FILE-2)", () => {
    expect(showsPoints("in_progress")).toBe(true);
    expect(showsPoints("not_started")).toBe(false);
    expect(showsPoints(null)).toBe(false);
  });
});
