import { formatRecentMoment } from "@injurysub/domain";
import {
  BoardRow,
  BoardRowGap,
  Button,
  FreshnessNote,
  HeadlineAnswer,
  MatchupScore,
  Note,
  Notice,
  OutCard,
  SectionHeader,
  StatusPill,
} from "@injurysub/ui";
import type { ReactNode } from "react";
import {
  type BoardRosterRow,
  type BoardStarter,
  isLoadedBoard,
  type TeamBoard,
} from "../../lib/server/board";
import { faceImageProps, logoImageProps } from "../../lib/server/images";
import type { TeamHistory } from "../../lib/server/request-view";
import {
  AFTER_LAST_GAME,
  commissionerWord,
  dayChangeNote,
  gamesText,
  gameText,
  headlineSentence,
  nextGameLine,
  noTeamCopy,
  optionCountLine,
  points,
  requestPill,
  sideToday,
  signedPoints,
  staleNotice,
  startingDayText,
  weekLabel,
} from "./board-copy";
import { surname } from "./option-copy";
import { OptionGroups } from "./option-groups";
import { RequestRows } from "./request-rows";

type Found = Extract<TeamBoard, { status: "board" }>;

export type BoardViewProps = {
  // The page shows the database-down page itself, outside the shell.
  board: TeamBoard | { status: "no_team" };
  history: TeamHistory | null;
  zone: string;
  now: Date;
  commissionerName: string | null;
  title: string;
  subtitle: string;
  // The answer to a request just made or refused, from the address.
  notice?: ReactNode;
};

type Context = { zone: string; now: Date; commissioner: string; name: string | null };

// The manager's team page: their OUT starters first, the matchup, the roster and their requests.
export function BoardView(props: BoardViewProps) {
  const context: Context = {
    zone: props.zone,
    now: props.now,
    commissioner: commissionerWord(props.commissionerName),
    name: props.commissionerName,
  };
  const requests = <YourRequests history={props.history} context={context} />;
  return (
    <div className="page">
      <header className="pagehead">
        <div className="min-w-0">
          <div className="t-title ellipsis">{props.title}</div>
          <div className="pagehead-subtitle">{props.subtitle}</div>
        </div>
      </header>
      {props.notice}
      {isLoadedBoard(props.board) ? (
        <FoundBoard board={props.board} requests={requests} context={context} />
      ) : (
        <NoTeam status={props.board.status} requests={requests} context={context} />
      )}
    </div>
  );
}

function NoTeam(props: {
  status: Exclude<BoardViewProps["board"]["status"], "board">;
  requests: ReactNode;
  context: Context;
}) {
  const copy = noTeamCopy(props.status, props.context.name);
  return (
    <div className="cols">
      <div className="col">
        <section className="headline" aria-labelledby="team-headline">
          <h1 id="team-headline" className="t-headline is-none">
            {copy.title}
          </h1>
          <p>{copy.sentence}</p>
          {copy.retry && (
            <Button asChild variant="secondary" icon="refresh" className="mt-(--space-14)">
              <a href="/app">Try again</a>
            </Button>
          )}
        </section>
      </div>
      <div className="col">{props.status === "no_team" ? null : props.requests}</div>
    </div>
  );
}

function FoundBoard({
  board,
  requests,
  context,
}: {
  board: Found;
  requests: ReactNode;
  context: Context;
}) {
  const cards = [...board.outStarters, ...board.suspendedStarters];
  const matchup = <Matchup board={board} context={context} />;
  const notices = (
    <>
      {board.week.afterLastGame && <Notice tone="wait">{AFTER_LAST_GAME}</Notice>}
      {board.stale && (
        <Notice tone="info" action={{ label: "Try again", href: "/app" }}>
          {staleNotice(board.readAt, context.zone, context.name, context.now)}
        </Notice>
      )}
    </>
  );
  const after = (
    <>
      {board.stale ? null : (
        <FreshnessNote
          readAt={formatRecentMoment(new Date(board.readAt), context.zone, context.now)}
          refreshHref="/app"
        />
      )}
      <Roster board={board} context={context} />
      {requests}
    </>
  );
  if (cards.length === 0) {
    return (
      <div className="cols">
        <div className="col">
          {notices}
          {matchup}
          <Headline board={board} context={context} />
        </div>
        <div className="col">{after}</div>
      </div>
    );
  }
  return (
    <div className="cols">
      <div className="col">
        {notices}
        <Headline board={board} context={context} />
        {cards.map((starter) => (
          <StarterCard key={starter.playerId} board={board} starter={starter} context={context} />
        ))}
        <DeskOptions board={board} context={context} />
      </div>
      <div className="col">
        {matchup}
        {after}
      </div>
    </div>
  );
}

function Headline({ board, context }: { board: Found; context: Context }) {
  const only = board.outStarters.length === 1 ? board.outStarters[0] : undefined;
  const sentence = headlineSentence(
    {
      outCount: board.outStarters.length,
      suspendedCount: board.suspendedStarters.length,
      playoffs: board.week.playoffs,
      beforeFirstGame:
        only !== undefined && only.startingDays.length === 0 && board.week.beforeFirstGame,
      onlyStarterHasRequest: only?.request != null,
    },
    context.commissioner
  );
  return (
    <HeadlineAnswer
      out={board.outStarters.length}
      suspended={board.suspendedStarters.length}
      sentence={sentence}
    />
  );
}

function Matchup({ board, context }: { board: Found; context: Context }) {
  const { matchup, week } = board;
  if (matchup === null) return null;
  const read = { stale: board.stale, beforeFirstGame: week.beforeFirstGame };
  return (
    <MatchupScore
      week={weekLabel(week)}
      mine={{
        name: matchup.mine.name ?? board.teamName,
        total: points(matchup.mine.total),
        today: sideToday(matchup.mine, read),
      }}
      opponent={
        matchup.opponent === null
          ? null
          : {
              name: matchup.opponent.name ?? `Team ${matchup.opponent.teamId}`,
              total: points(matchup.opponent.total),
              today: sideToday(matchup.opponent, read),
            }
      }
      note={week.afterLastGame ? dayChangeNote(context.now, context.zone) : undefined}
    />
  );
}

// The one OUT starter's options beside his card at 1280; on a phone, Choose has them.
function DeskOptions({ board, context }: { board: Found; context: Context }) {
  const starter = deskStarter(board);
  if (starter === null) return null;
  return (
    <div className="desk-only">
      <div className="stack-12">
        <OptionGroups
          injuredId={starter.playerId}
          options={starter.options}
          route={board.readyRoute}
          commissioner={context.commissioner}
          zone={context.zone}
          grid="grid2 is-wide"
        />
      </div>
    </div>
  );
}

function deskStarter(board: Found): BoardStarter | null {
  const cards = [...board.outStarters, ...board.suspendedStarters];
  const [only] = cards;
  if (cards.length !== 1 || only === undefined || !canChoose(board, only)) return null;
  return only;
}

function canChoose(board: Found, starter: BoardStarter): boolean {
  const { readyNow, review } = starter.optionCounts;
  return (
    !board.stale && !board.week.afterLastGame && starter.request === null && readyNow + review > 0
  );
}

function StarterCard({
  board,
  starter,
  context,
}: {
  board: Found;
  starter: BoardStarter;
  context: Context;
}) {
  const suspended = starter.designation === "SUSPENSION";
  const games = starter.startingDays.length;
  return (
    <OutCard
      name={starter.name}
      slot={starter.slot}
      face={faceImageProps(String(starter.playerId), 256, { eager: true })}
      teamLine={`${starter.proTeam} · ${starter.position}`}
      nextGame={nextGameLine(starter.nextGame, games === 0, context.zone)}
      forfeit={points(starter.forfeitTenths / 10)}
      days={starter.startingDays.map(startingDayText)}
      games={gamesText(games)}
      stats={statLine(starter)}
      suspended={suspended}
    >
      <CardAction board={board} starter={starter} context={context} />
    </OutCard>
  );
}

function statLine({ weekToDate: line }: BoardStarter) {
  return [
    { label: "PTS", value: String(line.points) },
    { label: "REB", value: String(line.rebounds) },
    { label: "AST", value: String(line.assists) },
    { label: "STL", value: String(line.steals) },
    { label: "BLK", value: String(line.blocks) },
    { label: "TO", value: String(line.turnovers) },
  ];
}

// The card's end: his request, why no one fits, or Choose with its count.
function CardAction({
  board,
  starter,
  context,
}: {
  board: Found;
  starter: BoardStarter;
  context: Context;
}) {
  if (board.stale || board.week.afterLastGame) return null;
  if (starter.request !== null) return <CardRequest starter={starter} context={context} />;
  if (!canChoose(board, starter)) {
    return (
      <>
        <Note kind="stop">{`No one on your bench fits a legal lineup with ${surname(starter.name)} out.`}</Note>
        <p className="text-[13px] text-text-2">{`${context.commissioner} can look at moves InjurySub doesn't make.`}</p>
      </>
    );
  }
  return (
    <div className={deskStarter(board) === null ? "stack-6" : "phone-only stack-6"}>
      <Button asChild variant="primary" next>
        <a href={`/app/requests/new?injured=${starter.playerId}`}>Choose a replacement</a>
      </Button>
      <div className="text-center text-[12px] text-text-meta">
        {optionCountLine(starter.optionCounts, board.readyRoute, context.commissioner)}
      </div>
    </div>
  );
}

function CardRequest({ starter, context }: { starter: BoardStarter; context: Context }) {
  const request = starter.request;
  if (request === null) return null;
  const pill = requestPill(request.status, context.commissioner);
  return (
    <a className="reqrow card-request" href={`/app/requests/${request.requestId}`}>
      <div className="title ellipsis">{`${surname(request.replacementName)} in for ${surname(request.injuredName)}`}</div>
      <div className="t-amount">{signedPoints(request.amountTenths)}</div>
      <div className="when">{`Asked ${formatRecentMoment(request.filedAt, context.zone, context.now)}`}</div>
      <div className="pillcell">
        <StatusPill kind={pill.kind}>{pill.word}</StatusPill>
      </div>
    </a>
  );
}

function Roster({ board, context }: { board: Found; context: Context }) {
  const carded = new Set(
    [...board.outStarters, ...board.suspendedStarters].map((each) => each.playerId)
  );
  return (
    <>
      <section aria-labelledby="h-starters" className="stack-8">
        <SectionHeader id="h-starters" caps aside="Week · avg">
          Starters
        </SectionHeader>
        <div className="rows">
          {board.roster.starters.map((row, index) => (
            <RosterRow
              key={`${row.slot}-${index}`}
              row={row}
              carded={carded}
              stale={board.stale}
              context={context}
            />
          ))}
        </div>
      </section>
      <section aria-labelledby="h-bench" className="stack-8">
        <SectionHeader id="h-bench" caps>
          Bench
        </SectionHeader>
        <div className="rows">
          {board.roster.bench.map((row, index) => (
            <RosterRow
              key={`${row.slot}-${index}`}
              row={row}
              bench
              carded={carded}
              stale={board.stale}
              context={context}
            />
          ))}
        </div>
      </section>
    </>
  );
}

function RosterRow(props: {
  row: BoardRosterRow;
  bench?: boolean;
  carded: Set<number>;
  stale: boolean;
  context: Context;
}) {
  const { row, bench = false } = props;
  const { player } = row;
  if (player === null) return <BoardRowGap slot={row.slot} name="Empty" weekPoints="" />;
  if (props.carded.has(player.playerId)) {
    return (
      <BoardRowGap
        slot={row.slot}
        name={player.name}
        weekPoints={points(player.weekPoints)}
        suspended={player.designation === "SUSPENSION"}
      />
    );
  }
  const game = gameText(player, props.context.zone);
  const pill =
    player.designation === "OUT"
      ? "out"
      : player.designation === "SUSPENSION"
        ? "suspended"
        : undefined;
  return (
    <BoardRow
      slot={bench ? "BN" : row.slot}
      name={player.name}
      team={player.proTeam}
      logo={logoImageProps(player.proTeam, 42)}
      face={faceImageProps(String(player.playerId), 72)}
      meta={`${player.proTeam} · ${game.text}`}
      live={game.live && !props.stale}
      dayToDay={player.designation === "DAY_TO_DAY"}
      pill={bench ? pill : undefined}
      bench={bench}
      weekPoints={points(player.weekPoints)}
      average={player.seasonAveragePoints === null ? "—" : player.seasonAveragePoints.toFixed(1)}
    />
  );
}

function YourRequests({ history, context }: { history: TeamHistory | null; context: Context }) {
  if (history === null) return null;
  return (
    <section aria-labelledby="h-req" className="stack-8">
      <SectionHeader id="h-req">Your requests</SectionHeader>
      {history.status === "unavailable" ? (
        <Notice tone="info">
          {"Your requests can't be shown right now. Try again in a moment."}
        </Notice>
      ) : history.requests.length === 0 ? (
        <div className="list-panel px-(--space-16) py-(--space-14)">
          <p className="text-[14px] text-text-2">No requests yet.</p>
        </div>
      ) : (
        <RequestRows
          requests={history.requests}
          zone={context.zone}
          now={context.now}
          commissioner={context.commissioner}
        />
      )}
    </section>
  );
}
