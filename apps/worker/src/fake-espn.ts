import {
  createEspnReadClient,
  createEspnWriteClient,
  EspnError,
  type EspnErrorCode,
  type EspnReadOnlyClient,
  type EspnWriteClient,
  loadCommittedRecordings,
} from "@injurysub/espn";
import { z } from "zod";

// A stateful ESPN for the executor's tests, seeded from the committed recordings of the real
// league (captured on ESPN's day 8 of matchup 2, with rosters for days 7, 8 and 9). Reads go
// through the stub-mode read client over this fake's own copy, so the real parsers run; writes
// arrive through `fetch` (stub it with `fake.fetch`), so the real write client and transport run,
// and each applied write changes the copy as ESPN would. Test code only.

export type FakeWriteKind = "lineup" | "adjustment";

// How the fake answers a write: `apply` (200, applied); `ignore` (200, not applied: an answer is
// never proof); `lose_answer` (applied, then the connection drops); `refuse` (400),
// `unauthorized` (401) and `unavailable` (503), none of which apply it.
export type FakeWriteAnswer =
  | "apply"
  | "ignore"
  | "lose_answer"
  | "refuse"
  | "unauthorized"
  | "unavailable";

export type FakeEspnPost = { kind: FakeWriteKind; body: unknown };

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type FakeEspn = {
  read: EspnReadOnlyClient;
  // Sends live with synthetic cookies: ESPN is this fake once `fetch` is stubbed with it.
  write: EspnWriteClient;
  fetch: Fetch;
  // Every write ESPN received, in order, refused ones included.
  posts: readonly FakeEspnPost[];
  failReads(code: EspnErrorCode | null): void;
  answerWrites(kind: FakeWriteKind, answer: FakeWriteAnswer): void;
  // Every answer, read or write, waits this long first; a write's own deadline still cuts it off.
  // A slow read never times out, as recorded reads don't.
  delayAnswers(ms: number): void;
  // Sets a player's injury designation (ESPN's injuryStatus) wherever the recordings list him.
  setDesignation(playerId: number, status: string): void;
};

type Json = Record<string, unknown>;

type FakeState = {
  responses: Map<string, unknown>;
  posts: FakeEspnPost[];
  readFailure: EspnErrorCode | null;
  delayMs: number;
  answers: Record<FakeWriteKind, FakeWriteAnswer>;
};

const WRITES_HOST = "lm-api-writes.fantasy.espn.com";

const credentials = {
  espnS2: "AEBsyntheticCookieValue%2Bfor%2Btests%3D",
  swid: "{A1B2C3D4-1111-4111-8111-0000000000AA}",
};

const lineupBodySchema = z.object({
  teamId: z.number(),
  scoringPeriodId: z.number(),
  items: z
    .array(
      z.object({ playerId: z.number(), fromLineupSlotId: z.number(), toLineupSlotId: z.number() })
    )
    .min(1),
});
type LineupBody = z.infer<typeof lineupBodySchema>;

const scheduleSideSchema = z.object({
  teamId: z.number(),
  adjustment: z.number(),
  adjustmentReason: z.string(),
});
type ScheduleSide = z.infer<typeof scheduleSideSchema>;

const scheduleBodySchema = z.tuple([
  z.object({ id: z.number(), home: scheduleSideSchema, away: scheduleSideSchema }),
]);
type ScheduleBody = z.infer<typeof scheduleBodySchema>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordsIn(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

// The team's roster entries in every recorded answer that holds rosters, with that answer's day.
function teamRosters(responses: Map<string, unknown>, teamId: number) {
  const rosters: { day: number; entries: Json[] }[] = [];
  for (const body of responses.values()) {
    if (!isRecord(body) || typeof body.scoringPeriodId !== "number") continue;
    const team = recordsIn(body.teams).find((candidate) => candidate.id === teamId);
    if (team === undefined || !isRecord(team.roster)) continue;
    rosters.push({ day: body.scoringPeriodId, entries: recordsIn(team.roster.entries) });
  }
  return rosters;
}

// What ESPN does with a lineup body, as far as B13 probed it: an edit whose every item names the
// player's slot that day applies; an exact repeat of an applied edit is refused (409
// TRAN_ROSTER_SAME_SLOT). Any other body went unprobed, so the fake won't guess.
function lineupOutcome(responses: Map<string, unknown>, body: LineupBody): "applies" | "same_slot" {
  const thatDay = teamRosters(responses, body.teamId).find(
    (roster) => roster.day === body.scoringPeriodId
  );
  if (thatDay === undefined) {
    throw new Error(
      `fake ESPN holds no roster for team ${body.teamId} on day ${body.scoringPeriodId}`
    );
  }
  const slotOf = (playerId: number) =>
    thatDay.entries.find((entry) => entry.playerId === playerId)?.lineupSlotId;
  if (body.items.every((item) => slotOf(item.playerId) === item.toLineupSlotId)) return "same_slot";
  if (body.items.every((item) => slotOf(item.playerId) === item.fromLineupSlotId)) return "applies";
  throw new Error(
    "fake ESPN got a lineup body whose fromLineupSlotId isn't the player's slot that day and that isn't an exact repeat of an applied edit: ESPN's answer to one is unprobed (B13), so no test may rely on it"
  );
}

// ESPN applies an edit from the body's day through the matchup's end; the recordings hold only
// the captured matchup's days.
function applyLineup(responses: Map<string, unknown>, body: LineupBody): void {
  for (const roster of teamRosters(responses, body.teamId)) {
    if (roster.day < body.scoringPeriodId) continue;
    for (const item of body.items) {
      const entry = roster.entries.find((candidate) => candidate.playerId === item.playerId);
      if (entry !== undefined) entry.lineupSlotId = item.toLineupSlotId;
    }
  }
}

// ESPN's total includes the adjustment, so it moves by the change.
function setAdjustment(side: Json, sent: ScheduleSide): void {
  const before = typeof side.adjustment === "number" ? side.adjustment : 0;
  if (typeof side.totalPoints === "number") {
    side.totalPoints = Math.round((side.totalPoints - before + sent.adjustment) * 10) / 10;
  }
  side.adjustment = sent.adjustment;
  side.adjustmentReason = sent.adjustmentReason;
}

function applySchedule(responses: Map<string, unknown>, body: ScheduleBody): void {
  const [matchup] = body;
  const entries = [...responses.values()]
    .flatMap((answer) => (isRecord(answer) ? recordsIn(answer.schedule) : []))
    .filter((entry) => entry.id === matchup.id);
  if (entries.length === 0) throw new Error(`fake ESPN holds no matchup ${matchup.id}`);
  for (const entry of entries) {
    for (const sent of [matchup.home, matchup.away]) {
      const side = [entry.home, entry.away].filter(isRecord).find((s) => s.teamId === sent.teamId);
      if (side === undefined) {
        throw new Error(`fake ESPN's matchup ${matchup.id} has no side for team ${sent.teamId}`);
      }
      setAdjustment(side, sent);
    }
  }
}

function espnRefusal(status: number, type: string): Response {
  return Response.json({ messages: [type], details: [{ type, resolved: false }] }, { status });
}

// The answers that refuse a write without applying it.
const REFUSALS: Partial<Record<FakeWriteAnswer, () => Response>> = {
  refuse: () => espnRefusal(400, "FAKE_REFUSED"),
  unauthorized: () => espnRefusal(401, "AUTH_LEAGUE_NOT_VISIBLE"),
  unavailable: () => new Response("Service Unavailable", { status: 503 }),
};

// What fetch throws when the connection drops after the request went out (Node 24, B2's spike).
function droppedConnection(): TypeError {
  const socketError = Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" });
  return new TypeError("fetch failed", { cause: socketError });
}

// Waits, unless the signal aborts first: then rejects with its reason, as fetch does.
function wait(ms: number, signal?: AbortSignal | null): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  if (ms === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function writeKindOf(input: string | URL | Request, init?: RequestInit): FakeWriteKind {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (init?.method === "POST" && url.hostname === WRITES_HOST) {
    if (url.pathname.endsWith("/transactions/")) return "lineup";
    if (url.pathname.endsWith("/schedule")) return "adjustment";
  }
  throw new Error(
    `fake ESPN takes only ESPN's lineup and schedule writes, not ${init?.method ?? "GET"} ${url.origin}${url.pathname}`
  );
}

// Applies a write unless told not to, and answers as ESPN does once it has.
function applyWrite(state: FakeState, kind: FakeWriteKind, body: unknown, apply: boolean) {
  if (kind === "lineup") {
    const edit = lineupBodySchema.parse(body);
    if (lineupOutcome(state.responses, edit) === "same_slot") {
      return espnRefusal(409, "TRAN_ROSTER_SAME_SLOT");
    }
    if (apply) applyLineup(state.responses, edit);
    return Response.json({ ...edit, status: "EXECUTED" });
  }
  const schedule = scheduleBodySchema.parse(body);
  if (apply) applySchedule(state.responses, schedule);
  return Response.json(schedule);
}

async function answerWrite(state: FakeState, kind: FakeWriteKind, init?: RequestInit) {
  const body: unknown = JSON.parse(String(init?.body));
  state.posts.push({ kind, body });
  await wait(state.delayMs, init?.signal);
  const answer = state.answers[kind];
  const refusal = REFUSALS[answer];
  if (refusal !== undefined) return refusal();
  const response = applyWrite(state, kind, body, answer !== "ignore");
  if (answer === "lose_answer") throw droppedConnection();
  return response;
}

// Sets the player's injuryStatus in every recorded roster entry that lists him.
function setDesignation(responses: Map<string, unknown>, playerId: number, status: string) {
  for (const body of responses.values()) {
    if (!isRecord(body)) continue;
    for (const team of recordsIn(body.teams)) {
      if (!isRecord(team.roster)) continue;
      for (const entry of recordsIn(team.roster.entries)) {
        const pool = entry.playerPoolEntry;
        if (entry.playerId !== playerId || !isRecord(pool) || !isRecord(pool.player)) continue;
        pool.player.injuryStatus = status;
      }
    }
  }
}

function gatedReads(read: EspnReadOnlyClient, state: FakeState): EspnReadOnlyClient {
  const gated =
    <Args extends unknown[], Result>(method: (...args: Args) => Promise<Result>) =>
    async (...args: Args): Promise<Result> => {
      await wait(state.delayMs);
      if (state.readFailure !== null) {
        throw new EspnError(state.readFailure, `fake ESPN: reads fail with ${state.readFailure}`);
      }
      return method(...args);
    };
  return {
    mode: read.mode,
    getLineups: gated(read.getLineups),
    getLineup: gated(read.getLineup),
    getCurrentWeek: gated(read.getCurrentWeek),
    getTeamDay: gated(read.getTeamDay),
    checkCredentials: gated(read.checkCredentials),
    checkLeagueRules: gated(read.checkLeagueRules),
    getPlayerOutlook: gated(read.getPlayerOutlook),
    getTeamWeek: gated(read.getTeamWeek),
  };
}

export async function createFakeEspn(): Promise<FakeEspn> {
  const recorded = await loadCommittedRecordings();
  // A copy of its own: the loaded recordings are modules every reader in the process shares.
  const responses = new Map(
    [...recorded.responses].map(([key, body]) => [key, structuredClone(body)] as const)
  );
  const state: FakeState = {
    responses,
    posts: [],
    readFailure: null,
    delayMs: 0,
    answers: { lineup: "apply", adjustment: "apply" },
  };
  const read = createEspnReadClient({
    mode: "stub",
    recordings: async () => ({ ...recorded, responses: state.responses }),
  });
  return {
    read: gatedReads(read, state),
    write: createEspnWriteClient({
      sendMode: "live",
      credentials,
      leagueId: 4567123,
      season: recorded.season,
    }),
    fetch: async (input, init) => answerWrite(state, writeKindOf(input, init), init),
    posts: state.posts,
    failReads: (code) => {
      state.readFailure = code;
    },
    answerWrites: (kind, answer) => {
      state.answers[kind] = answer;
    },
    delayAnswers: (ms) => {
      state.delayMs = ms;
    },
    setDesignation: (playerId, status) => setDesignation(state.responses, playerId, status),
  };
}
