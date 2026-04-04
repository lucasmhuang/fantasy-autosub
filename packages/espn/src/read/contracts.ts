export type EspnRosterSnapshot = {
  teamId: number;
  scoringPeriodId: number;
  starters: Array<{
    playerId: number;
    lineupSlotId: number;
    injuryStatus?: string;
  }>;
  bench: Array<{
    playerId: number;
    lineupSlotId: number;
  }>;
};

export interface EspnReadClient {
  getRoster(teamId: number, scoringPeriodId: number): Promise<EspnRosterSnapshot>;
}

