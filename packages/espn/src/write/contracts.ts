// What the ESPN writes take and return. Only the worker writes, and only through this client.
import type { MatchupAdjustments } from "../read/contracts";

// Whether writes reach ESPN: `never` (the default) records each write without sending it; `live`
// sends it.
export type EspnSendMode = "never" | "live";

// One player's move in a lineup edit, by slot name ("BE" is the bench).
export type LineupWriteMove = { playerId: number; fromSlot: string; toSlot: string };

// A league-manager lineup edit. ESPN applies it from `scoringPeriodId` through the matchup's last
// day; the moves go in one transaction, in the order given.
export type LineupWrite = {
  teamId: number;
  scoringPeriodId: number;
  moves: readonly LineupWriteMove[];
};

// The team's side of its matchup set to `targetTenths`, the opponent's side sent back as read.
// The matchup is the week read's, or one read by its id once its week has ended.
export type AdjustmentWrite = {
  matchup: Pick<MatchupAdjustments, "matchupId" | "home" | "away">;
  teamId: number;
  targetTenths: number;
  reason: string;
};

export type LineupTransactionBody = {
  isLeagueManager: true;
  teamId: number;
  type: "ROSTER";
  memberId: string;
  scoringPeriodId: number;
  executionType: "EXECUTE";
  items: {
    playerId: number;
    type: "LINEUP";
    fromLineupSlotId: number;
    toLineupSlotId: number;
  }[];
  isActingAsTeamOwner: false;
  skipTransactionCounters: false;
};

export type ScheduleSideBody = { teamId: number; adjustment: number; adjustmentReason: string };

export type ScheduleAdjustmentBody = [
  { id: number; home: ScheduleSideBody; away: ScheduleSideBody },
];

// What each write needs from its caller: the teams automation may write to now, and a step that
// runs with the exact body just before it is sent. The worker records its attempt there, so a
// crash mid-send leaves a record; a step that throws sends nothing.
export type WriteGuard = {
  allowlist: ReadonlySet<number>;
  beforeSend: (body: LineupTransactionBody | ScheduleAdjustmentBody) => Promise<void>;
};

// ESPN's answer is never proof that a write applied: the caller reads ESPN back.
export type EspnWriteResult<Body> =
  | { outcome: "sent"; body: Body; answer: unknown }
  | { outcome: "recorded_only"; body: Body };

export interface EspnWriteClient {
  applyLineup(
    write: LineupWrite,
    guard: WriteGuard
  ): Promise<EspnWriteResult<LineupTransactionBody>>;
  applyAdjustment(
    write: AdjustmentWrite,
    guard: WriteGuard
  ): Promise<EspnWriteResult<ScheduleAdjustmentBody>>;
}
