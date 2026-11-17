import { randomUUID } from "node:crypto";
import {
  type DatabaseExecutor,
  subRequestSnapshots,
  subRequests,
  writeLeagueSettings,
} from "@injurysub/db";
import { createEspnReadClient } from "@injurysub/espn";
import { describe, expect } from "vitest";
import { loadRequestDetail } from "./commish";
import { actOnRequest } from "./commish-actions";
import { fileOnBehalfRequest } from "./on-behalf";
import {
  insertInventedUser,
  setRefusingWebEspn,
  setWebEspn,
  type TeamWeekChange,
  webDbTest,
} from "./test-support";

// Team 1 in the scenarios: Damian Lillard (6606) is OUT; Day'Ron Sharpe (4432194), a bench
// center, plays on day 8 (2026-10-27), tipping at 23:30Z (4:30 PM PDT). Filing happens at 8 PM
// PDT that day, on ESPN's day 8.
const LILLARD = 6606;
const SHARPE = 4432194;
const now = new Date("2026-10-28T03:00:00Z");

const line = (fantasyPoints: number) => ({
  fantasyPoints,
  points: 0,
  rebounds: 0,
  assists: 0,
  steals: 0,
  blocks: 0,
  turnovers: 0,
});

// Sharpe also played on day 7 (tip 2026-10-26T23:00Z, 4 PM PDT), finishing with 12.4.
const sharpeOnDay7: TeamWeekChange = (read) => ({
  ...read,
  players: read.players.map((player) =>
    player.playerId !== SHARPE
      ? player
      : {
          ...player,
          weekGames: [
            {
              scoringPeriodId: 7,
              date: "2026-10-26T23:00:00.000Z",
              opponentProTeamId: 2,
              opponent: "BOS",
              home: true,
            },
            ...player.weekGames,
          ],
        }
  ),
  days: read.days.map((day) =>
    day.scoringPeriodId !== 7
      ? day
      : {
          ...day,
          players: day.players.map((player) =>
            player.playerId === SHARPE ? { ...player, line: line(12.4) } : player
          ),
        }
  ),
});

function scripted(change?: TeamWeekChange): void {
  setWebEspn(createEspnReadClient({ mode: "scripted", scenario: "one-out-starter" }), change);
}

async function commissioner(db: DatabaseExecutor, teamId: number | null = null) {
  const userId = await insertInventedUser(db, { role: "commissioner", teamId });
  return { userId, role: "commissioner" as const, teamId };
}

function filing(fields: Record<string, string>): FormData {
  const form = new FormData();
  const all = {
    team: "1",
    injured: String(LILLARD),
    replacement: String(SHARPE),
    designation: "OUT",
    idempotencyKey: randomUUID(),
    zone: "America/Los_Angeles",
    ...fields,
  };
  for (const [name, value] of Object.entries(all)) form.set(name, value);
  return form;
}

describe("fileOnBehalfRequest", () => {
  webDbTest(
    "accepts a moment before the replacement's tip, keeping the attested and the filing designations",
    async ({ database }) => {
      const { db } = database.connection;
      scripted();
      const user = await commissioner(db);

      const result = await fileOnBehalfRequest({
        user,
        form: filing({ moment: "2026-10-27T15:00", replacementGame: "not_started" }),
        now,
      });

      expect(result.status).toBe("recorded");
      expect(await db.select().from(subRequests)).toMatchObject([
        {
          kind: "on_behalf",
          teamId: 1,
          requestedBy: user.userId,
          requestMoment: new Date("2026-10-27T22:00:00Z"),
          filedAt: now,
          requestDay: 8,
          designationAtRequest: "OUT",
          designationAtFiling: "OUT",
          attestedFields: ["designation", "replacement_game"],
          replacementPointsAtRequestTenths: 0,
          snapshotSource: "observed",
        },
      ]);
      const [snapshot] = await db.select().from(subRequestSnapshots);
      expect(snapshot).toMatchObject({ takenAt: now, payload: { taken: "at_filing" } });
    }
  );

  webDbTest(
    "refuses a moment after the replacement's tip attested as before it",
    async ({ database }) => {
      const { db } = database.connection;
      scripted();

      const result = await fileOnBehalfRequest({
        user: await commissioner(db),
        form: filing({ moment: "2026-10-27T17:00", replacementGame: "not_started" }),
        now,
      });

      expect(result).toEqual({
        status: "not_filed",
        errors: [
          { field: "replacementGame", code: "game_had_started", tipAt: "2026-10-27T23:30:00.000Z" },
        ],
        refusal: null,
      });
      expect(await db.select().from(subRequests)).toEqual([]);
    }
  );

  webDbTest(
    "refuses hand-entered points while the replacement's day is still going",
    async ({ database }) => {
      const { db } = database.connection;
      scripted();

      const result = await fileOnBehalfRequest({
        user: await commissioner(db),
        form: filing({
          moment: "2026-10-27T17:00",
          replacementGame: "in_progress",
          enteredPoints: "3.0",
          note: "Screenshot from the group chat.",
        }),
        now,
      });

      expect(result).toEqual({
        status: "not_filed",
        errors: [{ field: "enteredPoints", code: "not_final" }],
        refusal: null,
      });
      expect(await db.select().from(subRequests)).toEqual([]);
    }
  );

  webDbTest(
    "accepts hand-entered points within his final line once the day is final",
    async ({ database }) => {
      const { db } = database.connection;
      scripted(sharpeOnDay7);

      const result = await fileOnBehalfRequest({
        user: await commissioner(db),
        form: filing({
          moment: "2026-10-26T17:00",
          replacementGame: "in_progress",
          enteredPoints: "5.0",
          note: "Screenshot from the group chat.",
        }),
        now,
      });

      expect(result.status).toBe("recorded");
      expect(await db.select().from(subRequests)).toMatchObject([
        {
          requestDay: 7,
          replacementPointsAtRequestTenths: 50,
          snapshotSource: "entered_by_hand",
          attestedFields: ["designation", "replacement_game", "points_at_request"],
        },
      ]);
    }
  );

  // A browser's maxLength counts a line break as one character, then sends it as CRLF.
  webDbTest(
    "accepts a 500-character note whose line breaks arrive as CRLF",
    async ({ database }) => {
      const { db } = database.connection;
      scripted(sharpeOnDay7);

      const result = await fileOnBehalfRequest({
        user: await commissioner(db),
        form: filing({
          moment: "2026-10-26T17:00",
          replacementGame: "in_progress",
          enteredPoints: "5.0",
          note: `${"a".repeat(249)}\r\n${"b".repeat(250)}`,
        }),
        now,
      });

      expect(result.status).toBe("recorded");
    }
  );

  webDbTest("refuses hand-entered points above his final line", async ({ database }) => {
    const { db } = database.connection;
    scripted(sharpeOnDay7);

    const result = await fileOnBehalfRequest({
      user: await commissioner(db),
      form: filing({
        moment: "2026-10-26T17:00",
        replacementGame: "in_progress",
        enteredPoints: "13.0",
        note: "Screenshot from the group chat.",
      }),
      now,
    });

    expect(result).toEqual({
      status: "not_filed",
      errors: [{ field: "enteredPoints", code: "out_of_range", limitTenths: 124 }],
      refusal: null,
    });
    expect(await db.select().from(subRequests)).toEqual([]);
  });

  // Points and note show only for a game in progress; typed before choosing another state, they
  // go unused (the line is observed) and the record never marks them hand-entered.
  for (const replacementGame of ["not_started", "ended"]) {
    webDbTest(
      `files a game attested as ${replacementGame}, leaving out the points typed before`,
      async ({ database }) => {
        const { db } = database.connection;
        scripted(sharpeOnDay7);

        const result = await fileOnBehalfRequest({
          user: await commissioner(db),
          // 3 PM PDT, before his 4 PM tip on day 7.
          form: filing({
            moment: "2026-10-26T15:00",
            replacementGame,
            enteredPoints: "5.0",
            note: "Screenshot from the group chat.",
          }),
          now,
        });

        expect(result.status).toBe("recorded");
        expect(await db.select().from(subRequests)).toMatchObject([
          { attestedFields: ["designation", "replacement_game"], snapshotSource: "observed" },
        ]);
      }
    );
  }

  webDbTest("refuses a filing for the commissioner's own team", async ({ database }) => {
    const { db } = database.connection;
    scripted();

    const result = await fileOnBehalfRequest({
      user: await commissioner(db, 1),
      form: filing({ moment: "2026-10-27T15:00", replacementGame: "not_started" }),
      now,
    });

    expect(result).toEqual({ status: "not_filed", errors: [], refusal: "own_team_on_behalf" });
    expect(await db.select().from(subRequests)).toEqual([]);
  });

  webDbTest(
    "counts a waiting request's expiry from its filing, not from a moment 13 hours before",
    async ({ database }) => {
      const { db } = database.connection;
      scripted();
      const user = await commissioner(db);
      await writeLeagueSettings(db, {
        executionMode: "approval_required",
        writeAllowlist: [1],
        updatedBy: user.userId,
        now,
        shownUpdatedAt: null,
      });

      const result = await fileOnBehalfRequest({
        user,
        // Fears (5144091), a bench guard, takes Lillard's slot directly; no game on day 8.
        form: filing({
          moment: "2026-10-27T07:00",
          replacement: "5144091",
          replacementGame: "not_started",
        }),
        now,
      });

      expect(result.status).toBe("recorded");
      const [request] = await db.select().from(subRequests);
      expect(request?.requestMoment.toISOString()).toBe("2026-10-27T14:00:00.000Z");
      expect(request?.expiresAt?.toISOString()).toBe("2026-10-28T15:00:00.000Z");
    }
  );
});

// H2, Q9, Q16: what the filing and the manual completion wrote is what the commissioner's detail
// reads back, through the real writers rather than hand-written event payloads.
describe("an on-behalf request's record on the commissioner's page", () => {
  webDbTest(
    "shows the filing's attestation and the amount computed at completion",
    async ({ database }) => {
      const { db } = database.connection;
      scripted(sharpeOnDay7);
      const user = await commissioner(db);
      await fileOnBehalfRequest({
        user,
        form: filing({
          moment: "2026-10-26T17:00",
          replacementGame: "in_progress",
          enteredPoints: "5.0",
          note: "Screenshot from the group chat.",
        }),
        now,
      });
      const [filed] = await db.select().from(subRequests);
      const requestId = filed?.requestId ?? "";
      const completion = new FormData();
      completion.set("version", String(filed?.version));
      completion.set("effectiveDay", "8");
      const completed = await actOnRequest({
        actorUserId: user.userId,
        actorTeamId: null,
        requestId,
        action: "complete",
        form: completion,
        now,
      });

      const detail = await loadRequestDetail({ requestId });

      expect(completed.status).toBe("completed_manually");
      if (detail.status !== "found") throw new Error(`detail ${detail.status}`);
      expect(detail.filing).toMatchObject({
        replacementGame: "in_progress",
        enteredTenths: 50,
        note: "Screenshot from the group chat.",
      });
      expect(detail.adjustment.appliedTenths).not.toBe(filed?.projectedAdjustmentTenths);
      expect(detail.adjustment.computedTenths).toBe(detail.adjustment.appliedTenths);
    }
  );
});

// FS-TIME-6, FS-FILE-3: the typed time is read in the zone the form's label named, which the form
// posts; ESPN's day for it is still counted in Pacific days.
describe("fileOnBehalfRequest's moment, in the zone the form named", () => {
  webDbTest(
    "reads 5:58 PM typed in Eastern as 2:58 PM PT, before the replacement's 4:30 PM PT tip",
    async ({ database }) => {
      const { db } = database.connection;
      scripted();

      const result = await fileOnBehalfRequest({
        user: await commissioner(db),
        form: filing({
          moment: "2026-10-27T17:58",
          zone: "America/New_York",
          replacementGame: "not_started",
        }),
        now,
      });

      expect(result.status).toBe("recorded");
      expect(await db.select().from(subRequests)).toMatchObject([
        { requestMoment: new Date("2026-10-27T21:58:00Z"), requestDay: 8 },
      ]);
    }
  );

  webDbTest(
    "counts a time typed where the date is already the next one for ESPN's day, still the earlier",
    async ({ database }) => {
      const { db } = database.connection;
      scripted();

      // Wed Oct 28, 8:00 AM in Tokyo is Tue Oct 27, 4:00 PM PDT: ESPN's day 8.
      const result = await fileOnBehalfRequest({
        user: await commissioner(db),
        form: filing({
          moment: "2026-10-28T08:00",
          zone: "Asia/Tokyo",
          replacementGame: "not_started",
        }),
        now,
      });

      expect(result.status).toBe("recorded");
      expect(await db.select().from(subRequests)).toMatchObject([
        { requestMoment: new Date("2026-10-27T23:00:00Z"), requestDay: 8 },
      ]);
    }
  );

  webDbTest(
    "reads a form that posts no zone, as forms did before, in Pacific",
    async ({ database }) => {
      const { db } = database.connection;
      scripted();
      const form = filing({ moment: "2026-10-27T15:00", replacementGame: "not_started" });
      form.delete("zone");

      const result = await fileOnBehalfRequest({ user: await commissioner(db), form, now });

      expect(result.status).toBe("recorded");
      expect(await db.select().from(subRequests)).toMatchObject([
        { requestMoment: new Date("2026-10-27T22:00:00Z") },
      ]);
    }
  );

  webDbTest("refuses a zone the form never offers as an invalid form", async ({ database }) => {
    const { db } = database.connection;
    scripted();

    const result = await fileOnBehalfRequest({
      user: await commissioner(db),
      form: filing({ day: "2026-10-27", time: "15:00", zone: "Not/A_Zone" }),
      now,
    });

    expect(result).toEqual({ status: "invalid_form" });
    expect(await db.select().from(subRequests)).toEqual([]);
  });

  // The repeated hour when daylight time ends, and the skipped one when it starts.
  webDbTest.for([
    [{ moment: "2026-11-01T01:30" }],
    [{ moment: "2027-03-14T02:30" }],
    [{ day: "2026-11-01", time: "01:30" }],
    [{ day: "2027-03-14", time: "02:30" }],
  ] as const)(
    "names the time field for %o in Eastern, a wall time with no one moment, reading no ESPN",
    async ([fields], { database }) => {
      const { db } = database.connection;
      setRefusingWebEspn("espn_unavailable");

      // Long after each moment, so none of them is refused for being in the future.
      const result = await fileOnBehalfRequest({
        user: await commissioner(db),
        form: filing({ ...fields, zone: "America/New_York", replacementGame: "not_started" }),
        now: new Date("2027-03-20T00:00:00Z"),
      });

      expect(result).toEqual({
        status: "not_filed",
        errors: [{ field: "time", code: "invalid" }],
        refusal: null,
      });
      expect(await db.select().from(subRequests)).toEqual([]);
    }
  );
});

// FS-FILE-3: the day and the time come as two fields, read together in the zone the form named.
describe("fileOnBehalfRequest's day and time", () => {
  webDbTest(
    "reads Tue Oct 27 at 5:58 PM typed in Eastern as 2:58 PM PT, on ESPN's day 8",
    async ({ database }) => {
      const { db } = database.connection;
      scripted();

      const result = await fileOnBehalfRequest({
        user: await commissioner(db),
        form: filing({
          day: "2026-10-27",
          time: "17:58",
          zone: "America/New_York",
          replacementGame: "not_started",
        }),
        now,
      });

      expect(result.status).toBe("recorded");
      expect(await db.select().from(subRequests)).toMatchObject([
        { requestMoment: new Date("2026-10-27T21:58:00Z"), requestDay: 8 },
      ]);
    }
  );

  webDbTest("names a time later than now at the time field", async ({ database }) => {
    const { db } = database.connection;
    setRefusingWebEspn("espn_unavailable");

    const result = await fileOnBehalfRequest({
      user: await commissioner(db),
      form: filing({ day: "2026-10-27", time: "21:00", replacementGame: "not_started" }),
      now,
    });

    expect(result).toEqual({
      status: "not_filed",
      errors: [{ field: "time", code: "future" }],
      refusal: null,
    });
    expect(await db.select().from(subRequests)).toEqual([]);
  });
});

// IF-FILE-4: every problem one post can know comes back together, at its field, and nothing is
// filed (SC-FILE-2).
describe("fileOnBehalfRequest's problems", () => {
  webDbTest("names every missing answer at once, without reading ESPN", async ({ database }) => {
    const { db } = database.connection;
    setRefusingWebEspn("espn_unavailable");
    const form = filing({ replacementGame: "in_progress" });
    form.delete("injured");
    form.delete("replacement");

    const result = await fileOnBehalfRequest({ user: await commissioner(db), form, now });

    expect(result).toEqual({
      status: "not_filed",
      errors: [
        { field: "injured", code: "missing" },
        { field: "replacement", code: "missing" },
        { field: "day", code: "missing" },
        { field: "time", code: "missing" },
        { field: "enteredPoints", code: "missing" },
        { field: "note", code: "missing" },
      ],
      refusal: null,
    });
    expect(await db.select().from(subRequests)).toEqual([]);
  });

  webDbTest("names points that aren't a number like 5.7", async ({ database }) => {
    const { db } = database.connection;
    scripted(sharpeOnDay7);

    const result = await fileOnBehalfRequest({
      user: await commissioner(db),
      form: filing({
        moment: "2026-10-26T17:00",
        replacementGame: "in_progress",
        enteredPoints: "5.75",
        note: "Screenshot from the group chat.",
      }),
      now,
    });

    expect(result).toEqual({
      status: "not_filed",
      errors: [{ field: "enteredPoints", code: "format" }],
      refusal: null,
    });
  });

  webDbTest(
    "names points above his final line and a missing note together (the canvas's F3)",
    async ({ database }) => {
      const { db } = database.connection;
      scripted(sharpeOnDay7);

      const result = await fileOnBehalfRequest({
        user: await commissioner(db),
        form: filing({
          moment: "2026-10-26T17:00",
          replacementGame: "in_progress",
          enteredPoints: "13.0",
        }),
        now,
      });

      expect(result).toEqual({
        status: "not_filed",
        errors: [
          { field: "enteredPoints", code: "out_of_range", limitTenths: 124 },
          { field: "note", code: "missing" },
        ],
        refusal: null,
      });
      expect(await db.select().from(subRequests)).toEqual([]);
    }
  );

  webDbTest("names a moment before the week at the time field", async ({ database }) => {
    const { db } = database.connection;
    scripted();

    const result = await fileOnBehalfRequest({
      user: await commissioner(db),
      form: filing({ day: "2026-10-20", time: "12:00", replacementGame: "not_started" }),
      now,
    });

    expect(result).toEqual({
      status: "not_filed",
      errors: [{ field: "time", code: "before_week" }],
      refusal: null,
    });
  });

  // ESPN's day past the week's last (after the season) puts a moment from today after it.
  webDbTest("names a moment after the week at the time field", async ({ database }) => {
    const { db } = database.connection;
    scripted((read) => ({ ...read, week: { ...read.week, todayScoringPeriodId: 14 } }));

    const result = await fileOnBehalfRequest({
      user: await commissioner(db),
      form: filing({ day: "2026-10-27", time: "19:00", replacementGame: "not_started" }),
      now,
    });

    expect(result).toEqual({
      status: "not_filed",
      errors: [{ field: "time", code: "after_week" }],
      refusal: null,
    });
  });

  webDbTest("gives a refusal for the whole form beside a field's problem", async ({ database }) => {
    const { db } = database.connection;
    scripted(sharpeOnDay7);
    const user = await commissioner(db);
    // Fears (5144091) takes Lillard's slot first, at 7 AM PDT on day 8.
    await fileOnBehalfRequest({
      user,
      form: filing({
        moment: "2026-10-27T07:00",
        replacement: "5144091",
        replacementGame: "not_started",
      }),
      now,
    });

    const result = await fileOnBehalfRequest({
      user,
      form: filing({
        moment: "2026-10-26T17:00",
        replacementGame: "in_progress",
        enteredPoints: "5.0",
      }),
      now,
    });

    expect(result).toEqual({
      status: "not_filed",
      errors: [{ field: "note", code: "missing" }],
      refusal: "active_request_exists",
    });
    expect(await db.select().from(subRequests)).toHaveLength(1);
  });

  // The form keeps one key for the page's life: a refused post leaves it unused, and a filing
  // posted again (its answer lost, say) gives back the request already filed.
  webDbTest(
    "files once for one key, refused first, then filed, then posted again",
    async ({ database }) => {
      const { db } = database.connection;
      scripted();
      const user = await commissioner(db);
      const key = randomUUID();
      const post = (moment: string) =>
        fileOnBehalfRequest({
          user,
          form: filing({ moment, replacementGame: "not_started", idempotencyKey: key }),
          now,
        });

      const refused = await post("2026-10-27T17:00");
      const filed = await post("2026-10-27T15:00");
      const again = await post("2026-10-27T15:00");

      expect(refused.status).toBe("not_filed");
      expect(filed.status).toBe("recorded");
      expect(again).toEqual(filed);
      expect(await db.select().from(subRequests)).toHaveLength(1);
    }
  );
});
