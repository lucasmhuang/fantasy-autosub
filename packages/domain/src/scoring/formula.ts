export const scoringWeights = {
  pts: 1,
  reb: 1.2,
  ast: 1.5,
  stl: 3,
  blk: 3,
  tov: -1
} as const;

export type BoxScore = {
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
};

export function calculateFantasyPoints(boxScore: BoxScore) {
  return (
    boxScore.pts * scoringWeights.pts +
    boxScore.reb * scoringWeights.reb +
    boxScore.ast * scoringWeights.ast +
    boxScore.stl * scoringWeights.stl +
    boxScore.blk * scoringWeights.blk +
    boxScore.tov * scoringWeights.tov
  );
}

