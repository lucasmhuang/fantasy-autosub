import { EspnError } from "../read/errors";
import type { EspnCredentials } from "../read/request";
import { buildScheduleAdjustment } from "./adjustment";
import type {
  EspnSendMode,
  EspnWriteClient,
  EspnWriteResult,
  LineupTransactionBody,
  ScheduleAdjustmentBody,
  WriteGuard,
} from "./contracts";
import { buildLineupTransaction } from "./lineup";
import { createWriteDeadline, type EspnWritePath, postEspnJson } from "./transport";

export type CreateEspnWriteClientOptions = {
  sendMode: EspnSendMode;
  // The owner's cookies: the SWID is also the member id each lineup edit is made as.
  credentials: EspnCredentials;
  leagueId: number;
  season: number;
};

// The allowlist is checked at every write, whatever the caller checked before, so a team taken
// off it mid-run gets nothing.
function refuseOffAllowlist(teamId: number, allowlist: ReadonlySet<number>): void {
  if (allowlist.has(teamId)) return;
  throw new EspnError(
    "team_not_allowed",
    `Team ${teamId} isn't on the automation allowlist, so nothing was sent to ESPN`
  );
}

export function createEspnWriteClient(options: CreateEspnWriteClientOptions): EspnWriteClient {
  async function send<Body extends LineupTransactionBody | ScheduleAdjustmentBody>(
    write: { body: Body; path: EspnWritePath; writeName: string },
    guard: WriteGuard
  ): Promise<EspnWriteResult<Body>> {
    await guard.beforeSend(write.body);
    if (options.sendMode === "never") return { outcome: "recorded_only", body: write.body };
    const answer = await postEspnJson({
      season: options.season,
      leagueId: options.leagueId,
      path: write.path,
      writeName: write.writeName,
      body: write.body,
      credentials: options.credentials,
      signal: createWriteDeadline(),
    });
    return { outcome: "sent", body: write.body, answer };
  }

  return {
    async applyLineup(write, guard) {
      refuseOffAllowlist(write.teamId, guard.allowlist);
      const body = buildLineupTransaction({ ...write, memberId: options.credentials.swid });
      return send(
        { body, path: "transactions/", writeName: `the lineup for team ${write.teamId}` },
        guard
      );
    },
    async applyAdjustment(write, guard) {
      refuseOffAllowlist(write.teamId, guard.allowlist);
      const body = buildScheduleAdjustment(write);
      const writeName = `the adjustment for team ${write.teamId} in matchup ${write.matchup.matchupId}`;
      return send({ body, path: "schedule", writeName }, guard);
    },
  };
}
