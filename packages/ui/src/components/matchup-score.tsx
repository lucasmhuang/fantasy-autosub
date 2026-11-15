// One side of the matchup: ESPN's total (complete days) and today's live points, as the reader
// sees them ("+110.5 today, live").
export type MatchupSide = { name: string; total: string; today?: string };

export type MatchupScoreProps = {
  // "Week 4 · Mon Nov 9 – Sun Nov 15".
  week: string;
  mine: MatchupSide;
  // None in a bye week.
  opponent: MatchupSide | null;
  // What each number is.
  note?: string;
};

function Opponent({ side }: { side: MatchupSide | null }) {
  if (!side) {
    return (
      <div className="opp">
        <div className="team ellipsis">No opponent</div>
        <div className="t-score text-text-faint">—</div>
        <div className="today text-text-meta">Bye this week</div>
      </div>
    );
  }
  return (
    <div className="opp">
      <div className="team ellipsis">{side.name}</div>
      <div className="t-score">{side.total}</div>
      {side.today && <div className="today">{side.today}</div>}
    </div>
  );
}

// This week's matchup at the top of the board. Only our live points carry the live dot: theirs
// don't change what the reader can do.
export function MatchupScore({ week, mine, opponent, note }: MatchupScoreProps) {
  return (
    <section
      className="panel px-(--space-16) pt-(--space-14) pb-(--space-12)"
      aria-label="This week's matchup"
    >
      <div className="t-label">{week}</div>
      <div className="score-grid">
        <div>
          <div className="team ellipsis">{mine.name}</div>
          <div className="t-score">{mine.total}</div>
          {mine.today && (
            <div className="today">
              <span className="live" />
              {mine.today}
            </div>
          )}
        </div>
        <div className="vs">vs</div>
        <Opponent side={opponent} />
      </div>
      {note && <div className="score-note">{note}</div>}
    </section>
  );
}
