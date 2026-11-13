import type { LineupWrite, Matchup, MatchupSide, WriteGuard } from "@injurysub/espn";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeEspn, type FakeEspn } from "./fake-espn";

// Team 1 as the recordings hold it: captured on ESPN's day 8, in matchup 2 (days 7-13), with
// rosters for days 7, 8 and 9.
const TEAM = 1;
const TODAY = 8;
const TOWNS = 3136195; // at C
const SHARPE = 4432194; // on the bench, C-eligible
const REED = 4278562; // at UTIL, C-eligible
const FEARS = 5144091; // on the bench, UTIL-eligible

const WRITES_URL =
  "https://lm-api-writes.fantasy.espn.com/apis/v3/games/fba/seasons/2027/segments/0/leagues/4567123";

const guard: WriteGuard = { allowlist: new Set([TEAM]), beforeSend: async () => {} };

// A direct swap: Towns to the bench, Sharpe into his C slot.
const swap: LineupWrite = {
  teamId: TEAM,
  scoringPeriodId: TODAY,
  moves: [
    { playerId: TOWNS, fromSlot: "C", toSlot: "BE" },
    { playerId: SHARPE, fromSlot: "BE", toSlot: "C" },
  ],
};

async function startFake(): Promise<FakeEspn> {
  const fake = await createFakeEspn();
  vi.stubGlobal("fetch", fake.fetch);
  return fake;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// The players' slots in team 1's lineup as ESPN shows it now (its day 8).
async function slotsNow(fake: FakeEspn, ...players: number[]): Promise<(string | undefined)[]> {
  const { team } = await fake.read.getLineup(TEAM);
  const slots = [...team.starters, ...team.bench, ...team.injuredReserve];
  return players.map((id) => slots.find((slot) => slot.player?.playerId === id)?.slot);
}

// The players' slots on one of team 1's recorded days.
async function slotsOn(fake: FakeEspn, day: number, ...players: number[]) {
  const { day: teamDay } = await fake.read.getTeamDay(TEAM, day);
  return players.map((id) => teamDay.players.find((player) => player.playerId === id)?.slot);
}

async function teamMatchup(fake: FakeEspn): Promise<Matchup> {
  const { week } = await fake.read.getCurrentWeek();
  const matchup = week.matchups.find((m) => m.home.teamId === TEAM || m.away?.teamId === TEAM);
  if (matchup === undefined) throw new Error("team 1 has no matchup in the recorded week");
  return matchup;
}

function sideOf(matchup: Matchup, teamId: number): MatchupSide {
  const side = [matchup.home, matchup.away].find((candidate) => candidate?.teamId === teamId);
  if (!side) throw new Error(`team ${teamId} isn't in matchup ${matchup.matchupId}`);
  return side;
}

function opponentOf(matchup: Matchup): MatchupSide | null | undefined {
  return [matchup.home, matchup.away].find((side) => side?.teamId !== TEAM);
}

describe("createFakeEspn", () => {
  it("shows a lineup edit from the body's day on, never on an earlier day, and records the POST", async () => {
    const fake = await startFake();

    const result = await fake.write.applyLineup(swap, guard);

    expect(await slotsNow(fake, TOWNS, SHARPE)).toEqual(["BE", "C"]);
    expect(await slotsOn(fake, TODAY, TOWNS, SHARPE)).toEqual(["BE", "C"]);
    expect(await slotsOn(fake, TODAY + 1, TOWNS, SHARPE)).toEqual(["BE", "C"]);
    expect(await slotsOn(fake, TODAY - 1, TOWNS, SHARPE)).toEqual(["C", "BE"]);
    expect(fake.posts).toEqual([{ kind: "lineup", body: result.body }]);
  });

  it("sets a side's adjustment rather than adding to it, and moves its total by the change", async () => {
    const fake = await startFake();
    const before = await teamMatchup(fake);

    await fake.write.applyAdjustment(
      { matchup: before, teamId: TEAM, targetTenths: 30, reason: "first" },
      guard
    );
    const between = await teamMatchup(fake);
    await fake.write.applyAdjustment(
      { matchup: between, teamId: TEAM, targetTenths: 51, reason: "second" },
      guard
    );

    const after = await teamMatchup(fake);
    expect(sideOf(after, TEAM)).toMatchObject({ adjustment: 5.1, adjustmentReason: "second" });
    expect(sideOf(after, TEAM).score).toBeCloseTo(sideOf(before, TEAM).score + 5.1, 6);
    expect(opponentOf(after)).toEqual(opponentOf(before));
  });

  it("applies a three-item edit whole: every item's player moves", async () => {
    const fake = await startFake();

    await fake.write.applyLineup(
      {
        teamId: TEAM,
        scoringPeriodId: TODAY,
        moves: [
          { playerId: TOWNS, fromSlot: "C", toSlot: "BE" },
          { playerId: REED, fromSlot: "UTIL", toSlot: "C" },
          { playerId: FEARS, fromSlot: "BE", toSlot: "UTIL" },
        ],
      },
      guard
    );

    expect(await slotsNow(fake, TOWNS, REED, FEARS)).toEqual(["BE", "C", "UTIL"]);
  });

  it("refuses an edit already applied, as ESPN did (HTTP 409 TRAN_ROSTER_SAME_SLOT), and changes nothing", async () => {
    const fake = await startFake();
    await fake.write.applyLineup(swap, guard);

    await expect(fake.write.applyLineup(swap, guard)).rejects.toMatchObject({
      code: "write_refused",
      status: 409,
      cause: expect.objectContaining({ message: "HTTP 409 TRAN_ROSTER_SAME_SLOT" }),
    });

    expect(await slotsNow(fake, TOWNS, SHARPE)).toEqual(["BE", "C"]);
    expect(fake.posts).toHaveLength(2);
  });

  it("throws on an outdated body that isn't an exact repeat, since ESPN's answer to one is unprobed", async () => {
    const fake = await startFake();
    const outdated: LineupWrite = {
      teamId: TEAM,
      scoringPeriodId: TODAY,
      moves: [{ playerId: TOWNS, fromSlot: "UTIL", toSlot: "BE" }],
    };

    await expect(fake.write.applyLineup(outdated, guard)).rejects.toThrow(/unprobed/);

    expect(await slotsNow(fake, TOWNS)).toEqual(["C"]);
  });

  it("applies a write whose answer it then loses, as a dropped connection", async () => {
    const fake = await startFake();
    fake.answerWrites("lineup", "lose_answer");

    await expect(fake.write.applyLineup(swap, guard)).rejects.toMatchObject({
      code: "outcome_unknown",
    });

    expect(await slotsNow(fake, TOWNS, SHARPE)).toEqual(["BE", "C"]);
  });

  it("answers 200 to a write it doesn't apply", async () => {
    const fake = await startFake();
    fake.answerWrites("lineup", "ignore");

    await expect(fake.write.applyLineup(swap, guard)).resolves.toMatchObject({ outcome: "sent" });

    expect(await slotsNow(fake, TOWNS, SHARPE)).toEqual(["C", "BE"]);
    expect(fake.posts).toHaveLength(1);
  });

  it.each([
    { answer: "refuse", status: 400, code: "write_refused" },
    { answer: "unauthorized", status: 401, code: "credentials_rejected" },
    { answer: "unavailable", status: 503, code: "espn_unavailable" },
  ] as const)("answers a lineup write $answer with HTTP $status, applies nothing, and still applies adjustments", async ({
    answer,
    status,
    code,
  }) => {
    const fake = await startFake();
    fake.answerWrites("lineup", answer);

    await expect(fake.write.applyLineup(swap, guard)).rejects.toMatchObject({ code, status });
    expect(await slotsNow(fake, TOWNS, SHARPE)).toEqual(["C", "BE"]);

    const matchup = await teamMatchup(fake);
    await fake.write.applyAdjustment(
      { matchup, teamId: TEAM, targetTenths: 10, reason: "r" },
      guard
    );
    expect(sideOf(await teamMatchup(fake), TEAM).adjustment).toBe(1);
  });

  it("fails every read with the code set, and reads again once it's cleared", async () => {
    const fake = await startFake();
    const reads = [
      () => fake.read.getLineups(),
      () => fake.read.getLineup(TEAM),
      () => fake.read.getCurrentWeek(),
      () => fake.read.getTeamDay(TEAM, TODAY),
      () => fake.read.checkCredentials(),
      () => fake.read.checkLeagueRules(),
      () => fake.read.getPlayerOutlook(TEAM),
      () => fake.read.getTeamWeek(TEAM),
    ];

    fake.failReads("credentials_rejected");
    for (const read of reads) {
      await expect(read()).rejects.toMatchObject({ code: "credentials_rejected" });
    }
    fake.failReads(null);
    for (const read of reads) await expect(read()).resolves.toBeDefined();
  });

  it("waits its delay before answering, and a write's deadline cuts a slow answer off as fetch does", async () => {
    const fake = await startFake();
    fake.delayAnswers(200);

    let start = performance.now();
    await fake.read.getLineup(TEAM);
    expect(performance.now() - start).toBeGreaterThanOrEqual(190);
    start = performance.now();
    const { body } = await fake.write.applyLineup(swap, guard);
    expect(performance.now() - start).toBeGreaterThanOrEqual(190);

    const cutOff = fake.fetch(`${WRITES_URL}/transactions/`, {
      method: "POST",
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20),
    });
    await expect(cutOff).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("refuses any request that isn't one of ESPN's two writes", async () => {
    const fake = await startFake();

    const other = fake.fetch("https://api.resend.com/emails", { method: "POST", body: "{}" });

    await expect(other).rejects.toThrow("fake ESPN takes only ESPN's lineup and schedule writes");
  });

  it("keeps each fake's ESPN to itself", async () => {
    const first = await startFake();
    await first.write.applyLineup(swap, guard);

    const second = await createFakeEspn();

    expect(await slotsNow(second, TOWNS, SHARPE)).toEqual(["C", "BE"]);
  });

  it("sets a player's designation wherever the recordings list him", async () => {
    const fake = await startFake();

    fake.setDesignation(TOWNS, "OUT");

    const { team } = await fake.read.getLineup(TEAM);
    const week = await fake.read.getTeamWeek(TEAM);
    const designationIn = (slots: typeof team.starters) =>
      slots.find((slot) => slot.player?.playerId === TOWNS)?.player?.designation;
    expect(designationIn(team.starters)).toEqual({ status: "OUT" });
    expect(designationIn(week.lineup.starters)).toEqual({ status: "OUT" });
  });

  it("answers the matchup's unplayed days (10-13) with the rosters and no lines, and an edit shows through the last", async () => {
    const fake = await startFake();

    const { day } = await fake.read.getTeamDay(TEAM, 12);
    expect(day.players.find((player) => player.playerId === TOWNS)?.slot).toBe("C");
    expect(day.players.every((player) => player.line === null)).toBe(true);

    await fake.write.applyLineup(swap, guard);

    expect(await slotsOn(fake, 13, TOWNS, SHARPE)).toEqual(["BE", "C"]);
  });

  it("leaves the items it's told to skip, applying the rest", async () => {
    const fake = await startFake();
    fake.skipLineupItems([1]);

    await fake.write.applyLineup(swap, guard);

    // The day read, since the lineup read refuses a bench of five.
    expect(await slotsOn(fake, TODAY, TOWNS, SHARPE)).toEqual(["BE", "BE"]);
  });

  it("can apply an edit from a later day than its body names, as when ESPN's day changes mid-send", async () => {
    const fake = await startFake();
    fake.applyLineupFrom(TODAY + 1);

    await fake.write.applyLineup(swap, guard);

    expect(await slotsOn(fake, TODAY, TOWNS, SHARPE)).toEqual(["C", "BE"]);
    expect(await slotsOn(fake, TODAY + 1, TOWNS, SHARPE)).toEqual(["BE", "C"]);
  });
});
