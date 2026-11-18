import { describe, expect, it } from "vitest";
import type { BoardOption, BoardStarter } from "../../lib/server/board";
import { formsIn, linksIn, renderMarkup, textOf } from "../test-support";
import { type Confirmable, ConfirmView } from "./confirm-view";

const PT = "America/Los_Angeles";

const starter: BoardStarter = {
  playerId: 6606,
  name: "Damian Lillard",
  proTeam: "POR",
  position: "PG",
  gameState: null,
  slot: "G",
  designation: "OUT",
  weekToDate: {
    fantasyPoints: 46.5,
    points: 0,
    rebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
  },
  forfeitTenths: 465,
  todaysGame: null,
  nextGame: null,
  startingDays: [],
  request: null,
  options: [],
  hiddenOptionCount: 0,
  optionCounts: { readyNow: 1, review: 0, notValid: 0 },
};

const option: BoardOption = {
  playerId: 5144091,
  name: "Jeremiah Fears",
  proTeam: "NO",
  position: "PG",
  gameState: null,
  status: "ready_now",
  reason: null,
  takenFor: null,
  edit: {
    items: [
      { playerId: 6606, name: "Damian Lillard", fromSlot: "G", toSlot: "BE" },
      { playerId: 5144091, name: "Jeremiah Fears", fromSlot: "BE", toSlot: "G" },
    ],
    movedStarters: 0,
  },
  warnings: [],
  gamesLeft: 3,
  todaysGame: null,
  nextGame: null,
  upcomingGames: [],
  weekPoints: 0,
  seasonAveragePoints: 13.9,
  lineup: null,
};

const view = (fields: Partial<Confirmable> = {}): Confirmable => ({
  status: "confirm",
  teamName: "Invented Team",
  readAt: "2026-10-28T01:39:00.000Z",
  week: {
    matchupPeriodId: 2,
    playoffs: false,
    firstDate: "2026-10-26",
    lastDate: "2026-11-01",
    afterLastGame: false,
    beforeFirstGame: false,
    today: 8,
    days: [
      { scoringPeriodId: 7, date: "2026-10-26" },
      { scoringPeriodId: 8, date: "2026-10-27" },
    ],
  },
  route: "now",
  starter,
  option,
  projection: {
    totalTenths: -465,
    lines: [{ day: 7, name: "Damian Lillard", tenths: -465, why: "injured_credited_before_swap" }],
  },
  rulesHeld: false,
  idempotencyKey: "33333333-3333-4333-8333-333333333333",
  editShown: "digest",
  matchupPeriodId: 2,
  changedFrom: null,
  ...fields,
});

const EVENING = new Date("2026-10-28T01:39:00.000Z");

const render = (fields: Partial<Confirmable> = {}, zone = PT, now = EVENING) =>
  renderMarkup(<ConfirmView view={view(fields)} zone={zone} now={now} commissionerName="Sam Lee" />)
    .replaceAll("<!-- -->", "")
    .replaceAll("&#x27;", "'");

describe("ConfirmView", () => {
  // FS-CONFIRM-3: the starter's card over "To the bench" with what he forfeits, the replacement's
  // over "Into the lineup" with his average, slot, team and games left, a neutral mark between.
  it("draws the swap as two cards with a neutral mark between", () => {
    const html = render({ option: { ...option, seasonAveragePoints: 13.9 } });
    const pair = /<section class="swap-pair"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";

    expect(textOf(pair)).toMatch(/^To the bench.*46\.5Forfeits.*Lillard.*Into the lineup/);
    expect(textOf(pair)).toContain("13.9");
    expect(textOf(pair)).toContain("Season avg");
    // The corner logo already shows his team, so the band doesn't repeat it (each slot one fact).
    expect(textOf(pair)).toContain("G · 3 games left");
    expect(textOf(pair)).not.toContain("G · NO ·");
    expect(pair).toMatch(/<div class="arrow" aria-hidden="true">/);
  });

  // IF-CONFIRM-5: shown again after ESPN's lineup changed before Confirm.
  it("names who moves now against who was shown, and asks to confirm the new swap", () => {
    const html = renderMarkup(
      <ConfirmView
        view={view({ changedFrom: { now: "Lauri Markkanen", before: "Bam Adebayo" } })}
        zone={PT}
        now={EVENING}
        commissionerName="Sam Lee"
        notice={<p>generic notice</p>}
      />
    );

    expect(textOf(html)).toContain(
      "Your ESPN lineup changed: Markkanen moves now, not Adebayo. Nothing was recorded."
    );
    expect(textOf(html)).not.toContain("generic notice");
    expect(textOf(html)).toContain("Confirm new swap · −46.5");
    expect(textOf(render())).toContain("Confirm swap · −46.5");
  });

  it("says the swap, how it goes, and posts the same fields as before", () => {
    const html = render();

    expect(textOf(html)).toContain("Fears in for LillardReady now · a straight swap into G");
    expect(formsIn(html)).toEqual([
      {
        action: "/requests",
        method: "post",
        fields: [
          { tag: "input", type: "hidden", name: "injured", value: "6606" },
          { tag: "input", type: "hidden", name: "replacement", value: "5144091" },
          {
            tag: "input",
            type: "hidden",
            name: "idempotencyKey",
            value: "33333333-3333-4333-8333-333333333333",
          },
          { tag: "input", type: "hidden", name: "edit", value: "digest" },
          { tag: "input", type: "hidden", name: "period", value: "2" },
        ],
      },
    ]);
    expect(textOf(html)).toContain("Confirm swap · −46.5");
  });

  it("shows the projected adjustment day by day, and what happens after the tap", () => {
    const text = textOf(render());

    expect(text).toContain("Projected");
    expect(text).toContain("Lillard · Mon Oct 26");
    expect(text).toContain("The swap goes to ESPN now. −46.5 posts on ESPN.");
  });

  it("goes back to the replacements, never the old team-page chooser", () => {
    const hrefs = linksIn(render()).map((link) => link.href);

    expect(hrefs).toContain("/app/requests/new?injured=6606");
    expect(hrefs.some((href) => href?.includes("starter="))).toBe(false);
  });

  it("asks for approval, or sends to the commissioner, as the route goes", () => {
    expect(textOf(render({ route: "approval" }))).toContain("Send for approval · −46.5");
    expect(textOf(render({ route: "commissioner" }))).toContain("Send to Sam · −46.5");
  });

  it("says nothing is owed before his first points", () => {
    const text = textOf(render({ projection: { totalTenths: 0, lines: [] } }));

    expect(text).toContain("No adjustment");
    expect(text).toContain("Lillard hadn't played this week, so nothing is owed.");
    expect(text).toContain("The swap goes to ESPN now.");
    expect(text).toContain("Confirm swap · 0.0");
  });

  it("says the commissioner posts the adjustment while the league's rules differ", () => {
    const text = textOf(render({ rulesHeld: true }));

    expect(text).toContain(
      "Sam posts this adjustment by hand: the league's ESPN settings differ from InjurySub's."
    );
    expect(text).toContain("The swap runs now.");
  });

  it("warns, before the tap, that the replacement's points so far won't count", () => {
    const text = textOf(
      render({
        option: {
          ...option,
          warnings: ["already_scored"],
          weekPoints: 5.7,
          gameState: {
            homeProTeamId: 3,
            awayProTeamId: 1,
            tip: "2026-10-28T00:00:00.000Z",
            phase: "live",
            period: 2,
            clock: "1:00",
          },
        },
      })
    );

    expect(text).toContain(
      "Fears is playing now: 5.7 pts so far (6:39 PM PT). Whatever he has when you confirm won't count; everything after will."
    );
  });

  it("lists a one-move rearrangement's changes", () => {
    const text = textOf(
      render({
        option: {
          ...option,
          edit: {
            items: [
              { playerId: 6606, name: "Damian Lillard", fromSlot: "G", toSlot: "BE" },
              { playerId: 1, name: "Ajay Mitchell", fromSlot: "UTIL", toSlot: "G" },
              { playerId: 5144091, name: "Jeremiah Fears", fromSlot: "BE", toSlot: "UTIL" },
            ],
            movedStarters: 1,
          },
        },
      })
    );

    expect(text).toContain("Ready now · Ajay Mitchell moves to G to make room");
    expect(text).toContain("Moves from UTIL. His points count either way.");
    expect(text).toContain("Goes to the bench.");
  });

  it("says which ESPN day the swap counts for after midnight east of Pacific", () => {
    const pastMidnightEast = new Date("2026-10-28T04:30:00.000Z");

    expect(textOf(render({}, "America/New_York", pastMidnightEast))).toContain(
      "This swap counts for Tue Oct 27: ESPN's day doesn't change until 3:00 AM ET. Fears's points from earlier that day won't count."
    );
    expect(textOf(render())).not.toContain("This swap counts for");
    const longAfter = new Date("2026-11-16T04:30:00.000Z");
    expect(textOf(render({}, "America/New_York", longAfter))).not.toContain("This swap counts for");
  });
});
