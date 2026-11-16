import { formatMoment } from "@injurysub/domain";
import { Button } from "@injurysub/ui";
import { redirect } from "next/navigation";
import { CommishHeader } from "../../../../components/commish/commish-header";
import { formatReadTime } from "../../../../components/requests/format";
import { StatusNotice } from "../../../../components/requests/status-notice";
import { Shell } from "../../../../components/shell/shell";
import { Surface } from "../../../../components/shell/site-shell";
import {
  commissionerAccess,
  deviceZoneOf,
  getCurrentAuthenticatedSession,
} from "../../../../lib/server/auth";
import {
  type AlertEntry,
  type AlertsPage,
  loadAlertsPage,
  type TeamMove,
  type WatchState,
} from "../../../../lib/server/commish-alerts";
import { loadShell } from "../../../../lib/server/shell";
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
  const zone = deviceZoneOf(session);
  const { status } = await props.searchParams;
  const page = await loadAlertsPage();

  const shell = await loadShell(session);
  return (
    <Shell shell={shell} current="queue">
      <div className="page-shell">
        <div className="page-inner flex flex-col gap-6">
          <Surface className="rounded-[2rem] p-6 sm:p-8">
            <CommishHeader title="Alerts" />
            <StatusNotice status={renderCommissionerStatus(status ?? null)} />
            {page.status === "found" ? (
              <AlertsBody page={page} zone={zone} />
            ) : (
              <Muted text="The alerts can't be shown right now. Try again in a moment." />
            )}
          </Surface>
        </div>
      </div>
    </Shell>
  );
}

function AlertsBody({ page, zone }: { page: Found; zone: string }) {
  return (
    <div className="mt-6 flex flex-col gap-6">
      <p className="text-sm">{watchLine(page.watch, zone)}</p>
      <Section title="Open">
        {page.open.length === 0 ? (
          <Muted text="No open alerts." />
        ) : (
          page.open.map((alert) => <OpenAlert key={alert.alertId} alert={alert} zone={zone} />)
        )}
      </Section>
      <Section title="Your team's moves, the last day">
        {page.teamMoves.length === 0 ? (
          <Muted text="No moves on your team in the last day." />
        ) : (
          page.teamMoves.map((move) => (
            <MoveRow key={move.at.toISOString()} move={move} zone={zone} />
          ))
        )}
      </Section>
      <Section title="Acknowledged">
        {page.acknowledged.length === 0 ? (
          <Muted text="None yet." />
        ) : (
          page.acknowledged.map((alert) => (
            <AcknowledgedAlert key={alert.alertId} alert={alert} zone={zone} />
          ))
        )}
      </Section>
    </div>
  );
}

function watchLine(watch: WatchState, zone: string): string {
  if (watch.state === "not_started") {
    return "Misuse watch: not running yet. It starts once the worker has the ESPN cookie.";
  }
  if (watch.state === "watching") {
    return `Misuse watch: reading ESPN, last at ${formatReadTime(watch.checkedAt.toISOString(), zone)}.`;
  }
  const why =
    watch.reason === "credentials_rejected" ? "ESPN refused the cookie" : "ESPN can't be reached";
  return `Misuse watch: paused since ${formatMoment(watch.since, zone, "numericDate")}: ${why}.`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-medium">{title}</h2>
      {children}
    </section>
  );
}

function AlertFacts({ alert, zone }: { alert: AlertEntry; zone: string }) {
  const when = alert.espnAt === null ? null : formatMoment(alert.espnAt, zone, "numericDate");
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

function OpenAlert({ alert, zone }: { alert: AlertEntry; zone: string }) {
  return (
    <div className={`${CARD} flex flex-col gap-2`}>
      <AlertFacts alert={alert} zone={zone} />
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

function AcknowledgedAlert({ alert, zone }: { alert: AlertEntry; zone: string }) {
  const when =
    alert.acknowledgedAt === null ? "" : formatMoment(alert.acknowledgedAt, zone, "numericDate");
  return (
    <div className={`${CARD} flex flex-col gap-2`}>
      <AlertFacts alert={alert} zone={zone} />
      <p className="text-[color:var(--muted)]">
        {alert.acknowledgedNote ?? `Acknowledged ${when}.`}
      </p>
    </div>
  );
}

function MoveRow({ move, zone }: { move: TeamMove; zone: string }) {
  const items = move.items.map((item) =>
    item.fromSlot === null || item.toSlot === null
      ? `${item.type} ${item.player}`
      : `${item.player}: ${item.fromSlot} to ${item.toSlot}`
  );
  return (
    <div className={`${CARD} flex flex-col gap-1`}>
      <p className="text-[color:var(--muted)]">
        {formatReadTime(move.at.toISOString(), zone)} · {move.type}
        {move.byLeagueManager ? " · league manager" : ""}
      </p>
      <p>{items.join("; ")}</p>
    </div>
  );
}

function Muted({ text }: { text: string }) {
  return <p className="text-sm text-[color:var(--muted)]">{text}</p>;
}
