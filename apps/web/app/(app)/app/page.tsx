import { Button } from "@injurysub/ui";
import Link from "next/link";
import { redirect } from "next/navigation";
import { formatReadTime } from "../../../components/requests/format";
import { OptionRow } from "../../../components/requests/option-row";
import { StarterCard } from "../../../components/requests/starter-card";
import { SignOutForm, Surface } from "../../../components/shell/site-shell";
import { getCurrentAuthenticatedSession } from "../../../lib/server/auth";
import { type BoardStarter, loadTeamBoard, type TeamBoard } from "../../../lib/server/board";

type TeamPageSearchParams = { starter?: string; all?: string };

// Why there's no board to show (behaviors D18-D20, D22). In 5a nothing alerts the commissioner
// when ESPN refuses the credentials (that's 5c), so D19's message doesn't say they were told.
const UNAVAILABLE_MESSAGES: Record<Exclude<TeamBoard["status"], "board">, string> = {
  not_connected: "ESPN isn't connected yet, so there's nothing to request here for now.",
  unavailable: "ESPN can't be reached right now. Try again shortly.",
  credentials_rejected: "The app can't reach ESPN right now. Try again later.",
  season_over: "The season's last matchup week is over, so there's nothing left to request.",
};

export default async function TeamPage(props: { searchParams: Promise<TeamPageSearchParams> }) {
  const session = await getCurrentAuthenticatedSession();
  if (!session) redirect("/login?redirect=/app");
  const { user } = session;
  if (user.teamId === null && user.role === "commissioner") redirect("/commish/requests");

  const params = await props.searchParams;
  const revealAll = params.all === "1";
  const board =
    user.teamId === null ? null : await loadTeamBoard({ teamId: user.teamId, revealAll });
  return (
    <main className="page-shell">
      <div className="page-inner flex flex-col gap-6">
        <Surface className="rounded-[2rem] p-6 sm:p-8">
          <PageHeader
            title={board?.status === "board" ? board.teamName : "Your team"}
            isCommissioner={user.role === "commissioner"}
          />
          {board === null ? (
            <Notice text="Your account isn't linked to a team yet. Ask the commissioner." />
          ) : (
            <BoardBody board={board} chosen={params.starter} revealAll={revealAll} />
          )}
        </Surface>
      </div>
    </main>
  );
}

function PageHeader({ title, isCommissioner }: { title: string; isCommissioner: boolean }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <p className="display-kicker">Injury substitutions</p>
        <h1 className="mt-2 text-3xl font-medium tracking-[-0.04em] sm:text-4xl">{title}</h1>
      </div>
      <div className="flex flex-wrap gap-2">
        {isCommissioner ? (
          <Button asChild intent="ghost" size="sm">
            <Link href="/commish/requests">Commissioner</Link>
          </Button>
        ) : null}
        <SignOutForm />
      </div>
    </div>
  );
}

function Notice({ text }: { text: string }) {
  return <p className="mt-6 text-sm leading-7 text-[color:var(--muted)]">{text}</p>;
}

function BoardBody(props: { board: TeamBoard; chosen: string | undefined; revealAll: boolean }) {
  const { board } = props;
  if (board.status !== "board") return <Notice text={UNAVAILABLE_MESSAGES[board.status]} />;
  const starters = [...board.outStarters, ...board.suspendedStarters];
  const chosen = chosenStarter(starters, props.chosen);
  return (
    <div className="mt-6 flex flex-col gap-4">
      <p className="text-base">{board.headline}</p>
      <StarterList title={null} starters={board.outStarters} chosen={chosen} />
      <StarterList
        title="Suspended: the commissioner decides"
        starters={board.suspendedStarters}
        chosen={chosen}
      />
      {chosen === null ? null : <OptionList starter={chosen} revealAll={props.revealAll} />}
      <p className="text-xs text-[color:var(--muted)]">
        As of {formatReadTime(board.readAt)}. Confirming checks ESPN again.
      </p>
    </div>
  );
}

// The starter in the address, or the only one there is.
function chosenStarter(starters: BoardStarter[], requested: string | undefined) {
  const open = starters.filter((each) => each.request === null);
  const named = open.find((each) => String(each.playerId) === requested);
  if (named !== undefined) return named;
  return starters.length === 1 && open.length === 1 ? (open[0] ?? null) : null;
}

function StarterList(props: {
  title: string | null;
  starters: BoardStarter[];
  chosen: BoardStarter | null;
}) {
  if (props.starters.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      {props.title === null ? null : <h2 className="text-lg font-medium">{props.title}</h2>}
      {props.starters.map((starter) => (
        <StarterCard
          key={starter.playerId}
          starter={starter}
          chosen={props.chosen?.playerId === starter.playerId}
        />
      ))}
    </section>
  );
}

function OptionList({ starter, revealAll }: { starter: BoardStarter; revealAll: boolean }) {
  const base = `/app?starter=${starter.playerId}`;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">Replacements for {starter.name}</h2>
      {starter.options.length === 0 ? <Notice text="No bench player can take his place." /> : null}
      {starter.options.map((option) => (
        <OptionRow key={option.playerId} option={option} injuredId={starter.playerId} />
      ))}
      {revealAll || starter.hiddenOptionCount === 0 ? null : (
        <Link className="text-sm underline" href={`${base}&all=1`}>
          Show every bench player ({starter.hiddenOptionCount} not valid)
        </Link>
      )}
    </section>
  );
}
