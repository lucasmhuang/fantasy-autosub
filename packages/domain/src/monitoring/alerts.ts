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
