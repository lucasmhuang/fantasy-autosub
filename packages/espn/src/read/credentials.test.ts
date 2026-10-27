import { describe, expect, it } from "vitest";
import { type CreateReadClientOptions, createReadClient } from "./client";
import { CREDENTIAL_VIEWS, credentialResponseSchema } from "./credentials";
import { EspnError } from "./errors";
import { loadCommittedRecordings } from "./recordings";
import { createRecordedSource, requestKey } from "./source";

// Synthetic values only. No real member, team or league value ever belongs in this file.
const ownerSwid = "{A1B2C3D4-1111-4111-8111-0000000000AA}";
const rivalSwid = "{B1B2C3D4-2222-4222-8222-0000000000BB}";
const strangerSwid = "{C1C2C3C4-3333-4333-8333-0000000000CC}";

type OwnerOnlyFields = {
  watchList?: unknown[];
  pendingTransactions?: unknown[];
  draftStrategy?: { draftList?: unknown[] };
};

// ESPN's answer to the teams request. Only the owner's own cookies show the owner-only fields, and
// only on the owner's team.
function teamsAnswer(ownerOnly: OwnerOnlyFields) {
  return {
    teams: [
      { id: 3, owners: [rivalSwid] },
      { id: 7, owners: [ownerSwid], ...ownerOnly },
    ],
  };
}

function checkWith(body: unknown, options: CreateReadClientOptions = { ownerSwid }) {
  const responses = new Map([[requestKey({ kind: "league", views: CREDENTIAL_VIEWS }), body]]);
  const recordings = { capturedAt: "2026-10-27T08:00:00.000Z", season: 2027, responses };
  return createReadClient(
    createRecordedSource(async () => recordings),
    options
  ).checkCredentials();
}

async function checkFailure(check: Promise<unknown>): Promise<EspnError> {
  try {
    await check;
  } catch (error) {
    if (error instanceof EspnError) return error;
    throw error;
  }
  throw new Error("expected the check to fail");
}

describe("the ESPN credential check", () => {
  it.each([
    ["its watch list", { watchList: [3001] }],
    ["its pending claims", { pendingTransactions: [{ bidAmount: 7 }] }],
    ["its draft list", { draftStrategy: { draftList: [3001] } }],
  ])("accepts the cookies when the owner's team shows %s", async (_, ownerOnly) => {
    await expect(checkWith(teamsAnswer(ownerOnly))).resolves.toEqual({
      ok: true,
      source: "recorded",
    });
  });

  it("finds the owner's team from a member id configured without braces, in lower case", async () => {
    const configured = ownerSwid.replace(/[{}]/g, "").toLowerCase();

    await expect(
      checkWith(teamsAnswer({ watchList: [3001] }), { ownerSwid: configured })
    ).resolves.toMatchObject({ ok: true });
  });

  it("rejects cookies that read the league but don't show the owner's own fields", async () => {
    const failure = await checkFailure(checkWith(teamsAnswer({})));

    expect(failure.code).toBe("credentials_rejected");
    expect(failure.message).toMatch(/^ESPN credentials need refreshing/);
    expect(failure.message).not.toMatch(/A1B2C3D4/i);
  });

  it("rejects a configured member who owns no team in the league, without naming the member", async () => {
    const failure = await checkFailure(
      checkWith(teamsAnswer({ watchList: [3001] }), { ownerSwid: strangerSwid })
    );

    expect(failure.code).toBe("credentials_rejected");
    expect(failure.message).toMatch(/^ESPN credentials need refreshing/);
    expect(failure.message).not.toMatch(/C1C2C3C4/i);
  });

  it("refuses to check without a configured member id", async () => {
    const failure = await checkFailure(checkWith(teamsAnswer({ watchList: [3001] }), {}));

    expect(failure.code).toBe("credentials_rejected");
  });
});

// The committed recording of the real league.
describe("the recorded credential check", () => {
  it("keeps one team's owner-only lists as empty markers, which the check accepts", async () => {
    const recordings = await loadCommittedRecordings();
    const body = recordings.responses.get(requestKey({ kind: "league", views: CREDENTIAL_VIEWS }));
    if (body === undefined) throw new Error("the recording holds no credential check request");
    const { teams } = credentialResponseSchema.parse(body);

    const marked = teams.filter(
      (team) => team.watchList !== undefined || team.pendingTransactions !== undefined
    );
    expect(marked).toHaveLength(1);
    const [owner] = marked;
    expect([owner?.watchList ?? [], owner?.pendingTransactions ?? []]).toEqual([[], []]);
    expect(owner?.draftStrategy).toBeUndefined();

    const source = createRecordedSource(async () => recordings);
    const check = createReadClient(source, { ownerSwid: owner?.owners?.[0] }).checkCredentials();
    await expect(check).resolves.toEqual({ ok: true, source: "recorded" });
  });
});
