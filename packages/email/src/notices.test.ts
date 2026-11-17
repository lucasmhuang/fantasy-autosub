import { describe, expect, it } from "vitest";
import {
  buildCredentialsRefusedOutboxEmail,
  buildMisuseAlertOutboxEmail,
  buildWatchPausedOutboxEmail,
} from "./index";
import type { MisuseAlertEmailInput } from "./notices";
import { scanEmailHtml, visibleTextOf } from "./test-support";

const SINCE = new Date("2026-11-12T02:31:00.000Z"); // Wed Nov 11, 6:31 PM PT
const FOOT = [
  "Sent to you as the league’s commissioner on InjurySub.",
  "Not affiliated with ESPN or the NBA.",
];

function linesOf(body: string): string[] {
  return body.split("\n");
}

describe("the cookie-refused email", () => {
  const input = { to: "commissioner@example.test", since: SINCE, waiting: 2, expiryHours: 12 };

  // FS-EMAIL-12, step 6's CREDENTIALS record word for word.
  it("says ESPN refused the cookie, since when, what waits, and that the watch is paused", async () => {
    const email = await buildCredentialsRefusedOutboxEmail(input);

    expect(email.subject).toBe("ESPN refused InjurySub’s access");
    expect(linesOf(email.body)).toEqual([
      "ESPN refused the league’s ESPN cookie, so InjurySub has stopped reading from and writing to ESPN.",
      "",
      "Since: Wed Nov 11, 6:31 PM PT",
      "Waiting requests: 2, shown to their managers as delayed",
      "Misuse watch: Paused until ESPN accepts a new cookie",
      "",
      "Once ESPN accepts a new cookie, InjurySub re-checks each waiting request before sending anything. Any request older than 12 hours comes to you instead.",
      "",
      "Renew the ESPN cookie on the host.",
      "",
      ...FOOT,
    ]);
    expect(scanEmailHtml(email.html)).toEqual([]);
    expect(email.dedupeKey).toBe(`espn-access:credentials_rejected:${SINCE.toISOString()}`);
  });

  it("says None when nothing was waiting", async () => {
    const email = await buildCredentialsRefusedOutboxEmail({ ...input, waiting: 0 });
    expect(linesOf(email.body)).toContain("Waiting requests: None");
  });
});

describe("the paused email", () => {
  // FS-EMAIL-13 as drawn: ESPN didn't answer.
  it("says InjurySub can't reach ESPN when ESPN didn't answer", async () => {
    const email = await buildWatchPausedOutboxEmail({
      to: "commissioner@example.test",
      since: SINCE,
      cause: "unreachable",
    });

    expect(email.subject).toBe("Misuse watch is paused");
    expect(linesOf(email.body)).toEqual([
      "InjurySub can’t reach ESPN, so it isn’t checking the league for changes it didn’t make.",
      "",
      "Since: Wed Nov 11, 6:31 PM PT",
      "Why: ESPN can’t be reached",
      "",
      "Until it’s back, a quiet inbox doesn’t mean nothing happened on ESPN. The watch starts again once ESPN answers.",
      "",
      "Nothing to do unless you see a change on ESPN you didn’t make.",
      "",
      ...FOOT,
    ]);
    expect(email.dedupeKey).toBe(`misuse-watch:paused:${SINCE.toISOString()}`);
    expect(scanEmailHtml(email.html)).toEqual([]);
  });

  // IF-EMAIL-6, Revision 6 H.
  it("says ESPN refused InjurySub's access when the watch's own read was refused", async () => {
    const email = await buildWatchPausedOutboxEmail({
      to: "commissioner@example.test",
      since: SINCE,
      cause: "refused",
    });
    const lines = linesOf(email.body);

    expect(lines[0]).toBe(
      "ESPN refused InjurySub’s access, so InjurySub isn’t checking the league for changes it didn’t make."
    );
    expect(lines).toContain("Why: ESPN refused InjurySub’s access");
  });
});

const ESPN_AT = new Date("2026-11-11T23:12:00.000Z"); // Wed Nov 11, 3:12 PM PT
const LINEUP: MisuseAlertEmailInput = {
  to: "commissioner@example.test",
  alertId: "alert-1",
  kind: "lm_transaction",
  teamId: 6,
  teamName: "Backdoor Cutters",
  espnAt: ESPN_AT,
  foundAt: new Date("2026-11-11T23:13:00.000Z"),
  what: "A league-manager lineup edit InjurySub didn't make on Backdoor Cutters, from ESPN's day 23: Move Pascal Siakam from F to BE. Move Bennedict Mathurin from BE to F.",
  undo: ["Move Bennedict Mathurin from F to BE.", "Move Pascal Siakam from BE to F."],
  moves: [
    { name: "Pascal Siakam", fromSlot: "F", toSlot: "BE" },
    { name: "Bennedict Mathurin", fromSlot: "BE", toSlot: "F" },
  ],
};

describe("the misuse email", () => {
  // FS-EMAIL-14 as drawn.
  it("names a lineup change, each move, ESPN's time and when it was seen, and how to undo it", async () => {
    const email = await buildMisuseAlertOutboxEmail(LINEUP);

    expect(email.subject).toBe("Misuse watch: Backdoor Cutters");
    expect(linesOf(email.body)).toEqual([
      "Someone made a league-manager lineup change on Backdoor Cutters that InjurySub didn’t make.",
      "",
      "Change: Siakam F → BN, Mathurin BN → F",
      "On ESPN: Wed Nov 11, 3:12 PM PT (seen 3:13 PM PT)",
      "To undo: Move Bennedict Mathurin from F to BE. Move Pascal Siakam from BE to F.",
      "",
      "Undo it on ESPN, or acknowledge it in InjurySub’s misuse watch if you made it.",
      "",
      "Removing InjurySub’s copy of the ESPN cookie doesn’t stop the cookie working.",
      "",
      ...FOOT,
    ]);
    expect(visibleTextOf(email.html)[0]).toBe(
      "Someone made a league-manager lineup change on Backdoor Cutters that InjurySub didn’t make."
    );
    expect(scanEmailHtml(email.html)).toEqual([]);
    expect(email.dedupeKey).toBe("misuse-alert:alert-1");
  });

  it("dates the seen time when it falls on another day, and says Seen without ESPN's time", async () => {
    const nextDay = await buildMisuseAlertOutboxEmail({
      ...LINEUP,
      foundAt: new Date("2026-11-12T16:00:00.000Z"),
    });
    const unknown = await buildMisuseAlertOutboxEmail({ ...LINEUP, espnAt: null });

    expect(linesOf(nextDay.body)).toContain(
      "On ESPN: Wed Nov 11, 3:12 PM PT (seen Thu Nov 12, 8:00 AM PT)"
    );
    expect(linesOf(unknown.body)).toContain("On ESPN: Seen Wed Nov 11, 3:13 PM PT");
  });

  // FS-EMAIL-16, Revision 6 G.
  it.each<[MisuseAlertEmailInput["kind"], number | null, string, string]>([
    [
      "lm_adjustment",
      6,
      "Misuse watch: Backdoor Cutters",
      "Change: Score adjustment on Backdoor Cutters",
    ],
    [
      "adjustment_mismatch",
      6,
      "Misuse watch: Backdoor Cutters",
      "Change: Adjustment differs on Backdoor Cutters",
    ],
    ["lm_league_change", null, "Misuse watch: the league", "Change: League setting changed"],
    ["league_public", null, "Misuse watch: the league", "Change: The league turned public"],
  ])("words a %s alert from the worker's sentence and the kind's title", async (kind, teamId, subject, change) => {
    const email = await buildMisuseAlertOutboxEmail({
      ...LINEUP,
      kind,
      teamId,
      teamName: teamId === null ? null : "Backdoor Cutters",
      what: "The worker's own sentence.",
      moves: [],
    });
    const lines = linesOf(email.body);

    expect(email.subject).toBe(subject);
    expect(lines[0]).toBe("The worker's own sentence.");
    expect(lines).toContain(change);
  });

  it("names a team without a stored name by its number", async () => {
    const email = await buildMisuseAlertOutboxEmail({ ...LINEUP, teamName: null, teamId: 2 });
    expect(email.subject).toBe("Misuse watch: Team 2");
  });
});
