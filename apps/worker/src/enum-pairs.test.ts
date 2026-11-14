import {
  espnAccessStateEnum,
  espnWriteKindEnum,
  espnWriteOutcomeEnum,
  espnWriteStatusEnum,
  leagueExecutionModeEnum,
  misuseAlertKindEnum,
  subRequestActorTypeEnum,
  subRequestAdjustmentStateEnum,
  subRequestKindEnum,
  subRequestLineupStateEnum,
  subRequestReviewReasonEnum,
  subRequestSnapshotPhaseEnum,
  subRequestSnapshotSourceEnum,
  subRequestStatusEnum,
  userRoleEnum,
} from "@injurysub/db";
import {
  adjustmentStates,
  espnAccessStates,
  espnWriteKinds,
  espnWriteOutcomes,
  espnWriteStatuses,
  leagueExecutionModes,
  lineupStates,
  misuseAlertKinds,
  requestActorTypes,
  requestSnapshotPhases,
  reviewReasons,
  snapshotSources,
  subRequestKinds,
  subRequestStatuses,
  userRoles,
} from "@injurysub/domain";
import { describe, expect, it } from "vitest";

// Each enum is declared twice: in domain, and as a pgEnum in db, which doesn't depend on domain.
// The worker depends on both, so the check that each pair agrees lives here.
const pairs = [
  ["user_role", userRoles, userRoleEnum],
  ["sub_request_kind", subRequestKinds, subRequestKindEnum],
  ["sub_request_status", subRequestStatuses, subRequestStatusEnum],
  ["sub_request_review_reason", reviewReasons, subRequestReviewReasonEnum],
  ["sub_request_lineup_state", lineupStates, subRequestLineupStateEnum],
  ["sub_request_adjustment_state", adjustmentStates, subRequestAdjustmentStateEnum],
  ["league_execution_mode", leagueExecutionModes, leagueExecutionModeEnum],
  ["sub_request_actor_type", requestActorTypes, subRequestActorTypeEnum],
  ["sub_request_snapshot_phase", requestSnapshotPhases, subRequestSnapshotPhaseEnum],
  ["sub_request_snapshot_source", snapshotSources, subRequestSnapshotSourceEnum],
  ["espn_write_kind", espnWriteKinds, espnWriteKindEnum],
  ["espn_write_status", espnWriteStatuses, espnWriteStatusEnum],
  ["espn_write_outcome", espnWriteOutcomes, espnWriteOutcomeEnum],
  ["espn_access_state", espnAccessStates, espnAccessStateEnum],
  ["misuse_alert_kind", misuseAlertKinds, misuseAlertKindEnum],
] as const;

describe("domain and database enums", () => {
  it.each(pairs)("agree on %s", (name, domainValues, pgEnum) => {
    expect(pgEnum.enumName).toBe(name);
    expect([...pgEnum.enumValues]).toEqual([...domainValues]);
  });
});
