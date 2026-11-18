// What a misuse alert is about (behaviors M1, M7): a league-manager edit in ESPN's transaction
// log, an adjustment or another league-manager change in the league's activity feed, that the app
// didn't make; a matchup adjustment unlike the app's own record of it; or the league turned
// public. Declared twice, as each enum is: here, and as a pgEnum in packages/db.
export const misuseAlertKinds = [
  "lm_transaction",
  "lm_adjustment",
  "lm_league_change",
  "adjustment_mismatch",
  "league_public",
] as const;
export type MisuseAlertKind = (typeof misuseAlertKinds)[number];

const TITLES: Record<MisuseAlertKind, (team: string) => string> = {
  lm_transaction: (team) => `Lineup change on ${team}`,
  lm_adjustment: (team) => `Adjustment on ${team}`,
  lm_league_change: () => "League settings changed",
  adjustment_mismatch: (team) => `Adjustment differs on ${team}`,
  league_public: () => "The league is public",
};

// An alert's one title (copy table 1, M), shared by the misuse watch page, the queue's row and
// the email's first sentence.
export function misuseAlertTitle(kind: MisuseAlertKind, team: string | null): string {
  return TITLES[kind](team ?? "a team");
}
