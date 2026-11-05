import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { describe, expect } from "vitest";
import { dbTest } from "./test-support";

// Invented people only.
async function insertCommissioner(pool: Pool): Promise<string> {
  const userId = randomUUID();
  await pool.query(
    `insert into user_accounts (user_id, email, team_id, display_name, role)
     values ($1, $2, 1, 'Invented Person', 'commissioner')`,
    [userId, `person-${userId}@example.test`]
  );
  return userId;
}

type RequestRow = {
  kind?: string;
  status?: string;
  teamId?: number;
  injuredPlayerId?: number;
  idempotencyKey?: string;
};

async function insertRequest(
  pool: Pool,
  requestedBy: string,
  row: RequestRow = {}
): Promise<string> {
  const requestId = randomUUID();
  await pool.query(
    `insert into sub_requests (
       request_id, kind, team_id, season, matchup_period_id, matchup_id, requested_by,
       idempotency_key, injured_player_id, injured_name, injured_slot, replacement_player_id,
       replacement_name, request_moment, filed_at, request_day, designation_at_request, status,
       execution_mode_at_request
     ) values (
       $1, $2, $3, 2027, 3, 31, $4, $5, $6, 'Invented Starter', 'G', 20, 'Invented Bench',
       now(), now(), 15, 'OUT', $7, 'approval_required'
     )`,
    [
      requestId,
      row.kind ?? "substitution",
      row.teamId ?? 5,
      requestedBy,
      row.idempotencyKey ?? randomUUID(),
      row.injuredPlayerId ?? 2,
      row.status ?? "needs_review",
    ]
  );
  return requestId;
}

async function refusalOf(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (error) {
    return error;
  }
  throw new Error("expected the database to refuse");
}

describe("sub_requests", () => {
  dbTest("records a request with its progress at its defaults", async ({ database }) => {
    const { pool } = database.connection;
    const requestId = await insertRequest(pool, await insertCommissioner(pool));

    const { rows } = await pool.query(
      "select lineup_state, adjustment_state, attested_fields, is_rehearsal, version from sub_requests where request_id = $1",
      [requestId]
    );
    expect(rows).toEqual([
      {
        lineup_state: "pending",
        adjustment_state: "pending",
        attested_fields: [],
        is_rehearsal: false,
        version: 0,
      },
    ]);
  });

  dbTest(
    "refuses a second active request for one injured player in a matchup",
    async ({ database }) => {
      const { pool } = database.connection;
      const commissioner = await insertCommissioner(pool);
      await insertRequest(pool, commissioner, { status: "completed" });

      expect(await refusalOf(insertRequest(pool, commissioner))).toMatchObject({
        code: "23505",
        constraint: "sub_requests_active_injured_unique",
      });
    }
  );

  dbTest(
    "accepts a new request once the earlier one was refused, rejected or withdrawn",
    async ({ database }) => {
      const { pool } = database.connection;
      const commissioner = await insertCommissioner(pool);
      for (const status of ["refused", "rejected", "withdrawn"]) {
        await insertRequest(pool, commissioner, { status });
      }

      await insertRequest(pool, commissioner);
      const { rows } = await pool.query("select count(*)::int as count from sub_requests");
      expect(rows).toEqual([{ count: 4 }]);
    }
  );

  dbTest("never lets a proving request block a real one for its starter", async ({ database }) => {
    const { pool } = database.connection;
    const commissioner = await insertCommissioner(pool);
    await insertRequest(pool, commissioner, { kind: "proving", status: "completed", teamId: 1 });

    await insertRequest(pool, commissioner, { teamId: 1 });
    await insertRequest(pool, commissioner, { kind: "proving", status: "completed", teamId: 1 });
  });

  dbTest("refuses a repeated idempotency key for one team", async ({ database }) => {
    const { pool } = database.connection;
    const commissioner = await insertCommissioner(pool);
    await insertRequest(pool, commissioner, { idempotencyKey: "confirm-1" });

    expect(
      await refusalOf(
        insertRequest(pool, commissioner, { idempotencyKey: "confirm-1", injuredPlayerId: 3 })
      )
    ).toMatchObject({ code: "23505", constraint: "sub_requests_team_idempotency_unique" });
  });
});

describe("league_settings", () => {
  dbTest(
    "holds one row, defaulting to approval-required with automation off",
    async ({ database }) => {
      const { pool } = database.connection;
      await pool.query("insert into league_settings default values");

      const { rows } = await pool.query(
        "select execution_mode, write_allowlist from league_settings"
      );
      expect(rows).toEqual([{ execution_mode: "approval_required", write_allowlist: [] }]);
      expect(
        await refusalOf(pool.query("insert into league_settings (settings_id) values (2)"))
      ).toMatchObject({
        code: "23514",
      });
    }
  );
});

describe("email_outbox", () => {
  dbTest(
    "refuses a second email with one dedupe key, and counts no attempts yet",
    async ({ database }) => {
      const { pool } = database.connection;
      const insert = () =>
        pool.query(
          `insert into email_outbox (email_id, dedupe_key, to_address, subject, body)
         values ($1, 'request-1:2', 'invented.person@example.test', 'Subject', 'Body')`,
          [randomUUID()]
        );
      await insert();

      expect(await refusalOf(insert())).toMatchObject({
        code: "23505",
        constraint: "email_outbox_dedupe_key_unique",
      });
      const { rows } = await pool.query("select attempts from email_outbox");
      expect(rows).toEqual([{ attempts: 0 }]);
    }
  );
});
