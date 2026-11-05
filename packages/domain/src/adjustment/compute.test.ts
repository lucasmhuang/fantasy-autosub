import { describe, expect, it } from "vitest";
import { type AdjustmentInput, type AdjustmentLine, computeAdjustment } from "./compute";

const injuredId = 4277961;
const replacementId = 4431736;
// Matchup week 2: days 7 (Mon 2026-10-26) to 13.
const weekTwo = [7, 8, 9, 10, 11, 12, 13];

function inputWith(overrides: Partial<AdjustmentInput>): AdjustmentInput {
  return {
    matchupDays: weekTwo,
    requestDay: 8,
    effectiveDay: 8,
    injured: { playerId: injuredId, creditedDays: [], earlierCredits: [] },
    replacement: { playerId: replacementId, days: [], tenthsAtRequest: 0 },
    ...overrides,
  };
}

function computed(input: AdjustmentInput): { totalTenths: number; lines: AdjustmentLine[] } {
  const result = computeAdjustment(input);
  if (!result.ok) throw new Error(`expected an adjustment, got ${result.reason}`);
  return result;
}

describe("computeAdjustment", () => {
  // The hand-made substitution of 2026-10-29: requested Tue 10/27 (day 8) before Toumani Camara's
  // game tipped, the edit effective Thursday (day 10); Jaren Jackson Jr. credited 12.6 on Monday.
  it("reproduces the team-8 substitution: +17.7, -12.6, total +5.1", () => {
    const result = computed(
      inputWith({
        requestDay: 8,
        effectiveDay: 10,
        injured: {
          playerId: injuredId,
          creditedDays: [{ day: 7, tenths: 126 }],
          earlierCredits: [],
        },
        replacement: {
          playerId: replacementId,
          days: [{ day: 8, tenths: 177 }],
          tenthsAtRequest: 0,
        },
      })
    );

    expect(result.lines).toEqual([
      { day: 7, playerId: injuredId, tenths: -126, why: "injured_credited_before_swap" },
      { day: 8, playerId: replacementId, tenths: 177, why: "replacement_after_request" },
    ]);
    expect(result.totalTenths).toBe(51);
  });

  it("deducts the replacement's points from before the request when the swap takes effect that day", () => {
    const result = computed(
      inputWith({
        requestDay: 8,
        effectiveDay: 8,
        replacement: {
          playerId: replacementId,
          days: [{ day: 8, tenths: 200 }],
          tenthsAtRequest: 80,
        },
      })
    );

    expect(result.lines).toEqual([
      { day: 8, playerId: replacementId, tenths: -80, why: "replacement_before_request" },
    ]);
    expect(result.totalTenths).toBe(-80);
  });

  it("credits the replacement's later points and bench days when the swap takes effect two days on", () => {
    const result = computed(
      inputWith({
        requestDay: 8,
        effectiveDay: 10,
        injured: {
          playerId: injuredId,
          creditedDays: [
            { day: 7, tenths: 126 },
            { day: 9, tenths: 30 },
          ],
          earlierCredits: [],
        },
        replacement: {
          playerId: replacementId,
          days: [
            { day: 8, tenths: 200 },
            { day: 9, tenths: 150 },
          ],
          tenthsAtRequest: 80,
        },
      })
    );

    expect(result.lines).toEqual([
      { day: 7, playerId: injuredId, tenths: -126, why: "injured_credited_before_swap" },
      { day: 8, playerId: replacementId, tenths: 120, why: "replacement_after_request" },
      { day: 9, playerId: injuredId, tenths: -30, why: "injured_credited_before_swap" },
      { day: 9, playerId: replacementId, tenths: 150, why: "replacement_on_bench" },
    ]);
    expect(result.totalTenths).toBe(114);
  });

  it("owes nothing when the starter went out before the week's first game and the swap beat it", () => {
    const result = computed(
      inputWith({
        requestDay: 7,
        effectiveDay: 7,
        replacement: { playerId: replacementId, days: [{ day: 7, tenths: 0 }], tenthsAtRequest: 0 },
      })
    );

    expect(result).toEqual({ ok: true, totalTenths: 0, lines: [] });
  });

  it("writes no line for a day the starter wasn't credited or credited with nothing", () => {
    const result = computed(
      inputWith({
        requestDay: 9,
        effectiveDay: 9,
        // Day 7 credited 0.0 (he played and recorded nothing); day 8 benched or no game (absent).
        injured: {
          playerId: injuredId,
          creditedDays: [
            { day: 7, tenths: 0 },
            { day: 9, tenths: 40 },
          ],
          earlierCredits: [],
        },
      })
    );

    expect(result.lines).toEqual([]);
  });

  it("writes no line for the starter on the effective day or after, which ESPN already leaves out", () => {
    const result = computed(
      inputWith({
        requestDay: 8,
        effectiveDay: 9,
        injured: {
          playerId: injuredId,
          creditedDays: [
            { day: 8, tenths: 50 },
            { day: 9, tenths: 60 },
            { day: 12, tenths: 70 },
          ],
          earlierCredits: [],
        },
      })
    );

    expect(result.lines).toEqual([
      { day: 8, playerId: injuredId, tenths: -50, why: "injured_credited_before_swap" },
    ]);
  });

  it("holds deductions only when the replacement's last game had ended before the request", () => {
    const result = computed(
      inputWith({
        requestDay: 8,
        effectiveDay: 10,
        injured: {
          playerId: injuredId,
          creditedDays: [{ day: 7, tenths: 126 }],
          earlierCredits: [],
        },
        replacement: {
          playerId: replacementId,
          days: [{ day: 8, tenths: 177 }],
          tenthsAtRequest: 177,
        },
      })
    );

    expect(result.lines).toEqual([
      { day: 7, playerId: injuredId, tenths: -126, why: "injured_credited_before_swap" },
    ]);
    expect(result.totalTenths).toBe(-126);
  });

  it("credits only the points after the request from a game in progress at the request", () => {
    const result = computed(
      inputWith({
        requestDay: 8,
        effectiveDay: 9,
        replacement: {
          playerId: replacementId,
          days: [{ day: 8, tenths: 200 }],
          tenthsAtRequest: 80,
        },
      })
    );

    expect(result.lines).toEqual([
      { day: 8, playerId: replacementId, tenths: 120, why: "replacement_after_request" },
    ]);
  });

  it("forfeits what an earlier request's adjustment credited the now-injured player", () => {
    const result = computed(
      inputWith({
        requestDay: 11,
        effectiveDay: 11,
        injured: {
          playerId: injuredId,
          creditedDays: [{ day: 10, tenths: 90 }],
          earlierCredits: [
            { day: 8, tenths: 177 },
            { day: 9, tenths: 45 },
          ],
        },
      })
    );

    expect(result.lines).toEqual([
      { day: 8, playerId: injuredId, tenths: -177, why: "earlier_credit_forfeited" },
      { day: 9, playerId: injuredId, tenths: -45, why: "earlier_credit_forfeited" },
      { day: 10, playerId: injuredId, tenths: -90, why: "injured_credited_before_swap" },
    ]);
    expect(result.totalTenths).toBe(-312);
  });

  it("refuses an effective day before the request's day, or a request day outside the matchup", () => {
    expect(computeAdjustment(inputWith({ requestDay: 9, effectiveDay: 8 }))).toEqual({
      ok: false,
      reason: "effective_day_before_request_day",
    });
    expect(computeAdjustment(inputWith({ requestDay: 14, effectiveDay: 14 }))).toEqual({
      ok: false,
      reason: "request_day_outside_matchup",
    });
  });

  // A10, A11: the team's final total doesn't depend on when the swap took effect.
  it("gives the same final total for every effective day, matching execution at the request", () => {
    const random = seededRandom(20261105);
    for (let trial = 0; trial < 500; trial += 1) {
      const scenario = randomScenario(random);
      const expected =
        sumFrom(scenario.replacementDays, scenario.requestDay) - scenario.tenthsAtRequest;

      for (const effectiveDay of daysFrom(scenario.requestDay)) {
        const result = computed(
          inputWith({
            requestDay: scenario.requestDay,
            effectiveDay,
            injured: {
              playerId: injuredId,
              creditedDays: scenario.injuredDays,
              earlierCredits: [],
            },
            replacement: {
              playerId: replacementId,
              days: scenario.replacementDays,
              tenthsAtRequest: scenario.tenthsAtRequest,
            },
          })
        );
        const espnCredits =
          sumBefore(scenario.injuredDays, effectiveDay) +
          sumFrom(scenario.replacementDays, effectiveDay);

        expect(espnCredits + result.totalTenths).toBe(expected);
        expect(result.lines.reduce((sum, line) => sum + line.tenths, 0)).toBe(result.totalTenths);
      }
    }
  });
});

type Scenario = {
  requestDay: number;
  tenthsAtRequest: number;
  injuredDays: { day: number; tenths: number }[];
  replacementDays: { day: number; tenths: number }[];
};

function randomScenario(random: () => number): Scenario {
  const requestDay = weekTwo[Math.floor(random() * weekTwo.length)]!;
  const injuredDays = randomDays(random);
  const replacementDays = randomDays(random);
  const requestDayTotal = replacementDays.find((line) => line.day === requestDay)?.tenths ?? 0;
  const tenthsAtRequest = Math.floor(random() * (requestDayTotal + 1));
  return { requestDay, tenthsAtRequest, injuredDays, replacementDays };
}

// Some days have no game; a game's line may be 0, or negative from turnovers.
function randomDays(random: () => number): { day: number; tenths: number }[] {
  return weekTwo
    .filter(() => random() < 0.6)
    .map((day) => ({ day, tenths: Math.floor(random() * 700) - 30 }));
}

function sumBefore(days: { day: number; tenths: number }[], before: number): number {
  return days.filter((line) => line.day < before).reduce((sum, line) => sum + line.tenths, 0);
}

function sumFrom(days: { day: number; tenths: number }[], from: number): number {
  return days.filter((line) => line.day >= from).reduce((sum, line) => sum + line.tenths, 0);
}

// Every effective day from the request's day through the matchup's last, and the day after it
// (the swap never took effect in this matchup).
function daysFrom(requestDay: number): number[] {
  const last = weekTwo[weekTwo.length - 1]!;
  const days: number[] = [];
  for (let day = requestDay; day <= last + 1; day += 1) days.push(day);
  return days;
}

// mulberry32: a small deterministic generator, so a failing case can be replayed.
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
