import { describe, expect, it } from "vitest";
import {
  buildCredentialsRefusedOutboxEmail,
  buildMisuseAlertOutboxEmail,
  buildWatchPausedOutboxEmail,
} from "./index";
import type { MisuseAlertEmailInput } from "./notices";
import { scanEmailHtml, visibleTextOf } from "./test-support";

const SINCE = new Date("2026-11-12T02:31:00.000Z"); // Wed Nov 11, 6:31 PM PT

function linesOf(body: string): string[] {
  return body.split("\n");
}

describe("the cookie-refused email", () => {
  const input = { to: "commissioner@example.test", since: SINCE, waiting: 2 };

  // FS-EMAIL-12; the friends voice (owner, 2026-11-17).
  it("says ESPN refused the cookie, since when, and how many requests wait, and nothing more", async () => {
    const email = await buildCredentialsRefusedOutboxEmail(input);

    expect(email.subject).toBe("ESPN refused InjurySub’s access");
    expect(linesOf(email.body)).toEqual([
      "ESPN refused the league’s cookie, so InjurySub can’t read or write ESPN.",
      "",
      "Since: Wed Nov 11, 6:31 PM PT",
      "Waiting requests: 2",
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
  // FS-EMAIL-13; the subject says the watch is paused, so the first sentence gives the cause.
  it("says InjurySub can't reach ESPN when ESPN didn't answer, and since when", async () => {
    const email = await buildWatchPausedOutboxEmail({
      to: "commissioner@example.test",
      since: SINCE,
      cause: "unreachable",
    });

    expect(email.subject).toBe("Misuse watch is paused");
    expect(linesOf(email.body)).toEqual([
      "InjurySub can’t reach ESPN.",
      "",
      "Since: Wed Nov 11, 6:31 PM PT",
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
    expect(linesOf(email.body)).toEqual([
      "ESPN refused InjurySub’s access.",
      "",
      "Since: Wed Nov 11, 6:31 PM PT",
    ]);
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
  // FS-EMAIL-14; the Change row is the undo, reversed.
  it("names a lineup change, each move and ESPN's time, and nothing more", async () => {
    const email = await buildMisuseAlertOutboxEmail(LINEUP);

    expect(email.subject).toBe("Misuse watch: Backdoor Cutters");
    expect(linesOf(email.body)).toEqual([
      "Someone made a league-manager lineup change on Backdoor Cutters that InjurySub didn’t make.",
      "",
      "Change: Siakam F → BN, Mathurin BN → F",
      "On ESPN: Wed Nov 11, 3:12 PM PT",
    ]);
    expect(visibleTextOf(email.html)[0]).toBe(
      "Someone made a league-manager lineup change on Backdoor Cutters that InjurySub didn’t make."
    );
    expect(scanEmailHtml(email.html)).toEqual([]);
    expect(email.dedupeKey).toBe("misuse-alert:alert-1");
  });

  it("gives ESPN's time alone, and when it was seen only if ESPN gave no time", async () => {
    const nextDay = await buildMisuseAlertOutboxEmail({
      ...LINEUP,
      foundAt: new Date("2026-11-12T16:00:00.000Z"),
    });
    const unknown = await buildMisuseAlertOutboxEmail({ ...LINEUP, espnAt: null });

    expect(linesOf(nextDay.body)).toContain("On ESPN: Wed Nov 11, 3:12 PM PT");
    expect(linesOf(unknown.body)).toContain("On ESPN: Seen Wed Nov 11, 3:13 PM PT");
  });

  // FS-EMAIL-16: the first sentence already names the change, so no Change row; the undo carries
  // the value to restore.
  it.each<[MisuseAlertEmailInput["kind"], number | null, string]>([
    ["lm_adjustment", 6, "Misuse watch: Backdoor Cutters"],
    ["adjustment_mismatch", 6, "Misuse watch: Backdoor Cutters"],
    ["lm_league_change", null, "Misuse watch: the league"],
    ["league_public", null, "Misuse watch: the league"],
  ])("words a %s alert from the worker's sentence, ESPN's time and the undo", async (kind, teamId, subject) => {
    const email = await buildMisuseAlertOutboxEmail({
      ...LINEUP,
      kind,
      teamId,
      teamName: teamId === null ? null : "Backdoor Cutters",
      what: "The worker's own sentence.",
      moves: [],
    });
    expect(email.subject).toBe(subject);
    expect(linesOf(email.body)).toEqual([
      "The worker's own sentence.",
      "",
      "On ESPN: Wed Nov 11, 3:12 PM PT",
      "To undo: Move Bennedict Mathurin from F to BE. Move Pascal Siakam from BE to F.",
    ]);
  });

  it("names a team without a stored name by its number", async () => {
    const email = await buildMisuseAlertOutboxEmail({ ...LINEUP, teamName: null, teamId: 2 });
    expect(email.subject).toBe("Misuse watch: Team 2");
  });
});
