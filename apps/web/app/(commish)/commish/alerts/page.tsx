import { Button } from "@injurysub/ui";
import { redirect } from "next/navigation";
import { CommishHeader } from "../../../../components/commish/commish-header";
import { formatReadTime } from "../../../../components/requests/format";
import { StatusNotice } from "../../../../components/requests/status-notice";
import { Surface } from "../../../../components/shell/site-shell";
import { commissionerAccess, getCurrentAuthenticatedSession } from "../../../../lib/server/auth";
import {
  type AlertEntry,
  type AlertsPage,
  loadAlertsPage,
  type TeamMove,
  type WatchState,
} from "../../../../lib/server/commish-alerts";
import { renderCommissionerStatus } from "../status-messages";

type Found = Extract<AlertsPage, { status: "found" }>;

const CARD =
  "rounded-[1.5rem] border border-[color:var(--line)] bg-[color:var(--surface-strong)] p-4 text-sm";

// Misuse detection's alerts (M1-M10): whether the watch is reading ESPN, what it found that the
// app didn't do, and the commissioner team's own moves to skim (M9).
export default async function CommissionerAlertsPage(props: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await getCurrentAuthenticatedSession();
  const access = commissionerAccess(session);
  if (access === "sign_in" || session === null) redirect("/login?redirect=/commish/alerts");
  if (access === "not_commissioner") redirect("/app");
  const { status } = await props.searchParams;
  const page = await loadAlertsPage();

  return (
    <main className="page-shell">
      <div className="page-inner flex flex-col gap-6">
        <Surface className="rounded-[2rem] p-6 sm:p-8">
          <CommishHeader title="Alerts" hasTeam={session.user.teamId !== null} />
          <StatusNotice status={renderCommissionerStatus(status ?? null)} />
          {page.status === "found" ? (
            <AlertsBody page={page} />
          ) : (
            <Muted text="The alerts can't be shown right now. Try again in a moment." />
          )}
        </Surface>
      </div>
    </main>
  );
}

function AlertsBody({ page }: { page: Found }) {
  return (
    <div className="mt-6 flex flex-col gap-6">
      <p className="text-sm">{watchLine(page.watch)}</p>
      <Section title="Open">
        {page.open.length === 0 ? (
          <Muted text="No open alerts." />
        ) : (
          page.open.map((alert) => <OpenAlert key={alert.alertId} alert={alert} />)
        )}
      </Section>
      <Section title="Your team's moves, the last day">
        {page.teamMoves.length === 0 ? (
          <Muted text="No moves on your team in the last day." />
        ) : (
          page.teamMoves.map((move) => <MoveRow key={move.at.toISOString()} move={move} />)
        )}
      </Section>
      <Section title="Acknowledged">
        {page.acknowledged.length === 0 ? (
          <Muted text="None yet." />
        ) : (
          page.acknowledged.map((alert) => <AcknowledgedAlert key={alert.alertId} alert={alert} />)
        )}
      </Section>
    </div>
  );
}

function watchLine(watch: WatchState): string {
  if (watch.state === "not_started") {
    return "Misuse watch: not running yet. It starts once the worker has the ESPN cookie.";
  }
  if (watch.state === "watching") {
    return `Misuse watch: reading ESPN, last at ${formatReadTime(watch.checkedAt.toISOString())}.`;
  }
  const why =
    watch.reason === "credentials_rejected" ? "ESPN refused the cookie" : "ESPN can't be reached";
  return `Misuse watch: paused since ${formatReadTime(watch.since.toISOString())}: ${why}.`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-medium">{title}</h2>
      {children}
    </section>
  );
}

function AlertFacts({ alert }: { alert: AlertEntry }) {
  const when = alert.espnAt === null ? null : formatReadTime(alert.espnAt.toISOString());
  return (
    <>
      <p className="font-medium">{alert.teamName ?? "The league"}</p>
      <p>{alert.what}</p>
      {when === null ? null : <p className="text-[color:var(--muted)]">ESPN’s time: {when}</p>}
      {alert.foundBeforeWatch ? (
        <p className="text-[color:var(--muted)]">On ESPN before the watch began.</p>
      ) : null}
    </>
  );
}

function OpenAlert({ alert }: { alert: AlertEntry }) {
  return (
    <div className={`${CARD} flex flex-col gap-2`}>
      <AlertFacts alert={alert} />
      <p className="font-medium">To undo it</p>
      <ul className="flex flex-col gap-1">
        {alert.undo.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ul>
      <form action={`/commish/alerts/${alert.alertId}/acknowledge`} method="post">
        <Button type="submit" intent="ghost" size="sm">
          Acknowledge
        </Button>
      </form>
    </div>
  );
}

function AcknowledgedAlert({ alert }: { alert: AlertEntry }) {
  const when =
    alert.acknowledgedAt === null ? "" : formatReadTime(alert.acknowledgedAt.toISOString());
  return (
    <div className={`${CARD} flex flex-col gap-2`}>
      <AlertFacts alert={alert} />
      <p className="text-[color:var(--muted)]">
        {alert.acknowledgedNote ?? `Acknowledged ${when}.`}
      </p>
    </div>
  );
}

function MoveRow({ move }: { move: TeamMove }) {
  const items = move.items.map((item) =>
    item.fromSlot === null || item.toSlot === null
      ? `${item.type} ${item.player}`
      : `${item.player}: ${item.fromSlot} to ${item.toSlot}`
  );
  return (
    <div className={`${CARD} flex flex-col gap-1`}>
      <p className="text-[color:var(--muted)]">
        {formatReadTime(move.at.toISOString())} · {move.type}
        {move.byLeagueManager ? " · league manager" : ""}
      </p>
      <p>{items.join("; ")}</p>
    </div>
  );
}

function Muted({ text }: { text: string }) {
  return <p className="text-sm text-[color:var(--muted)]">{text}</p>;
}
