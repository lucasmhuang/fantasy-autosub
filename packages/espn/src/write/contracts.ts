export type RosterExecutionStep = {
  type: "move" | "swap";
  description: string;
};

export interface EspnWriteClient {
  applyRosterStep(step: RosterExecutionStep): Promise<void>;
  applyScoreAdjustment(
    teamId: number,
    matchupId: number,
    adjustment: number,
    reason?: string
  ): Promise<void>;
}
