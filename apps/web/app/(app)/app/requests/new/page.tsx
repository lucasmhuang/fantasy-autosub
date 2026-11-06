import { formatTenths } from "@injurysub/domain";
import { Button } from "@injurysub/ui";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ADJUSTMENT_LINE_TEXT,
  NO_BOARD_TEXT,
  OPTION_REASON_TEXT,
  OPTION_STATUS_LABELS,
  OPTION_WARNING_TEXT,
} from "../../../../../components/requests/labels";
import { LineupPreview } from "../../../../../components/requests/lineup-preview";
import { StatusNotice } from "../../../../../components/requests/status-notice";
import { Surface } from "../../../../../components/shell/site-shell";
import { getCurrentAuthenticatedSession } from "../../../../../lib/server/auth";
import { type ConfirmationView, loadConfirmation } from "../../../../../lib/server/requests";
import { renderRequestStatus } from "../../status-messages";

type ConfirmSearchParams = { injured?: string; replacement?: string; status?: string };
type Confirmable = Extract<ConfirmationView, { status: "confirm" }>;

function playerId(value: string | undefined): number | null {
  return value !== undefined && /^\d{1,12}$/.test(value) ? Number(value) : null;
}

// The summary before Confirm (behaviors R1-R3): leaving it records nothing.
export default async function ConfirmRequestPage(props: {
  searchParams: Promise<ConfirmSearchParams>;
}) {
  const session = await getCurrentAuthenticatedSession();
  if (!session) redirect("/login?redirect=/app");
  const { teamId } = session.user;
  if (teamId === null) redirect("/app");
  const params = await props.searchParams;
  const injuredId = playerId(params.injured);
  const replacementId = playerId(params.replacement);
  if (injuredId === null || replacementId === null) redirect("/app?status=invalid_form");

  const view = await loadConfirmation({ teamId, injuredId, replacementId });
  return (
    <main className="page-shell">
      <div className="page-inner flex flex-col gap-6">
        <Surface className="rounded-[2rem] p-6 sm:p-8">
          <p className="display-kicker">Confirm the substitution</p>
          <StatusNotice status={renderRequestStatus(params.status ?? null)} />
          <ConfirmBody view={view} />
          <p className="mt-6 text-sm">
            <Link className="underline" href={`/app?starter=${injuredId}`}>
              Back to the options
            </Link>
          </p>
        </Surface>
      </div>
    </main>
  );
}

function ConfirmBody({ view }: { view: ConfirmationView }) {
  switch (view.status) {
    case "confirm":
      return <Summary view={view} />;
    case "already_requested":
      return (
        <p className="mt-6 text-sm">
          That starter already has a request this week.{" "}
          <Link className="underline" href={`/app/requests/${view.requestId}`}>
            See it
          </Link>
        </p>
      );
    case "not_offered":
      return <Muted text="That option isn't available anymore. Choose again." />;
    default:
      return <Muted text={NO_BOARD_TEXT[view.status]} />;
  }
}

function Muted({ text }: { text: string }) {
  return <p className="mt-6 text-sm leading-7 text-[color:var(--muted)]">{text}</p>;
}

function Summary({ view }: { view: Confirmable }) {
  const { starter, option } = view;
  return (
    <div className="mt-4 flex flex-col gap-4">
      <h1 className="text-2xl font-medium tracking-[-0.03em]">
        {option.name} in for {starter.name}
      </h1>
      <p className="text-sm text-[color:var(--muted)]">
        {starter.name} ({starter.slot}) goes to the bench; {option.name} takes the {starter.slot}{" "}
        slot. {OPTION_STATUS_LABELS[option.status]}.
      </p>
      {option.reason === null ? null : (
        <p className="text-sm">{OPTION_REASON_TEXT[option.reason]}</p>
      )}
      {option.warnings.map((warning) => (
        <p key={warning} className="text-sm text-[color:var(--warning)]">
          {OPTION_WARNING_TEXT[warning]}
        </p>
      ))}
      {option.lineup === null ? null : <LineupPreview lineup={option.lineup} />}
      <Projection view={view} />
      <ConfirmForm view={view} />
    </div>
  );
}

const RULES_HELD_TEXT =
  "ESPN's league settings differ from InjurySub's, so the adjustment will wait for the commissioner.";

// R2: the amount is a projection until ESPN shows the day the swap took effect; R12: none owed.
function Projection({ view }: { view: Confirmable }) {
  const { projection, rulesHeld } = view;
  const held = rulesHeld ? (
    <p className="text-sm text-[color:var(--warning)]">{RULES_HELD_TEXT}</p>
  ) : null;
  if (projection === null || projection.lines.length === 0) {
    return <div className="text-sm">No adjustment is projected: just the swap.{held}</div>;
  }
  return (
    <div className="rounded-[1.5rem] border border-white/8 bg-black/15 p-4 text-sm">
      <p className="font-medium">
        Projected adjustment: {formatTenths(projection.totalTenths, { signed: true })} points
      </p>
      <p className="mt-1 text-xs text-[color:var(--muted)]">
        Settled once ESPN shows the day the swap took effect.
      </p>
      <ul className="mt-3 grid gap-1">
        {projection.lines.map((line) => (
          <li key={`${line.day}-${line.name}-${line.why}`} className="flex gap-3">
            <span className="w-14 shrink-0 text-[color:var(--muted)]">Day {line.day}</span>
            <span className="flex-1">
              {line.name}: {ADJUSTMENT_LINE_TEXT[line.why]}
            </span>
            <span>{formatTenths(line.tenths, { signed: true })}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3">{held}</div>
    </div>
  );
}

function ConfirmForm({ view }: { view: Confirmable }) {
  return (
    <form action="/requests" method="post">
      <input type="hidden" name="injured" value={view.starter.playerId} />
      <input type="hidden" name="replacement" value={view.option.playerId} />
      <input type="hidden" name="idempotencyKey" value={view.idempotencyKey} />
      <Button type="submit">Confirm</Button>
    </form>
  );
}
