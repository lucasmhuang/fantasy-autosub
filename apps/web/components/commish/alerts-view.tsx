import { AlertRow, Button, Icon, Notice, RecordList } from "@injurysub/ui";
import { renderCommissionerStatus } from "../../app/(commish)/commish/status-messages";
import type { AlertEntry, AlertsPage, PageAutomation } from "../../lib/server/commish-alerts";
import { faceImageProps } from "../../lib/server/images";
import { AddressStatusNotice } from "../board/status-notice";
import { alertTimeLine, alertTitle, moveLine, watchLine, when } from "./alerts-copy";
import { CommishTitle } from "./commish-title";

type Reading = { zone: string; now: Date };
type Found = Extract<AlertsPage, { status: "found" }>;

const COOKIE = "Removing InjurySub's copy of the ESPN cookie doesn't stop the cookie working.";
const MOVES_HINT = "These look the same as your own moves; check for any you didn't make.";

// The misuse watch (FS-ALERTS-1 to -6): its state, the alerts with how to undo each, and the
// commissioner team's moves of the past day.
export function AlertsView(props: {
  page: Found;
  automation: PageAutomation;
  status: string | undefined;
  zone: string;
  now: Date;
}) {
  const { page } = props;
  const reading = { zone: props.zone, now: props.now };
  const watch = watchLine(page.watch, reading);
  return (
    <div className="page single flow">
      <CommishTitle
        title="Misuse watch"
        sub={watch.sub}
        automation={props.automation}
        from="/commish/alerts"
        zone={props.zone}
        now={props.now}
      />
      {watch.notice && (
        <Notice tone={page.watch.state === "paused" ? "fail" : "info"}>{watch.notice}</Notice>
      )}
      <AddressStatusNotice status={props.status} render={renderCommissionerStatus} />
      <div className="list-panel">
        {page.open.length === 0 ? (
          <p className="py-(--space-12) text-[14px] text-text-2">No alerts.</p>
        ) : (
          page.open.map((alert) => <Alert key={alert.alertId} alert={alert} reading={reading} />)
        )}
      </div>
      {page.acknowledged.length > 0 && (
        <Acknowledged alerts={page.acknowledged} reading={reading} />
      )}
      {page.open.length > 0 && <p className="text-[12px] text-text-meta">{COOKIE}</p>}
      {page.watch.state !== "paused" && page.teamMoves.length > 0 && (
        <section className="panel px-(--space-16) py-(--space-12)">
          <RecordList
            id="team-moves"
            title="Your team's moves, past 24 hours"
            events={page.teamMoves.map((move) => ({
              time: when(move.at, reading),
              text: moveLine(move),
            }))}
          />
          <p className="mt-(--space-6) text-[12px] text-text-meta">{MOVES_HINT}</p>
        </section>
      )}
    </div>
  );
}

function Acknowledged({ alerts, reading }: { alerts: AlertEntry[]; reading: Reading }) {
  return (
    <section aria-label="Acknowledged">
      <details className="group">
        <summary className="disclosure list-none [&::-webkit-details-marker]:hidden">
          <span className="t-label">{`Acknowledged · ${alerts.length}`}</span>
          <Icon name="chevron-down" size={18} className="ico group-open:rotate-180" />
        </summary>
        <div className="list-panel">
          {alerts.map((alert) => (
            <Alert key={alert.alertId} alert={alert} reading={reading} />
          ))}
        </div>
      </details>
    </section>
  );
}

// One alert: what happened, when, the players it moved, how to undo it, and Acknowledge; once
// acknowledged, when, or "Acknowledged automatically" with the completion it matched
// (IF-ALERTS-2).
function Alert({ alert, reading }: { alert: AlertEntry; reading: Reading }) {
  const matched = alert.acknowledgedNote !== null;
  return (
    <AlertRow
      title={alertTitle(alert.kind, alert.teamName)}
      when={alertTimeLine(alert.espnAt, alert.foundAt, reading)}
      what={matched ? (alert.acknowledgedNote ?? alert.what) : alertWhat(alert)}
      moves={alert.players.map((player) => ({
        face: faceImageProps(String(player.playerId), 40),
        text: player.name ?? "A player",
      }))}
      undo={
        matched || alert.undo.length === 0 ? undefined : (
          <>
            <b>To undo:</b> {alert.undo.join(" ")}
          </>
        )
      }
      action={<AlertAction alert={alert} matched={matched} reading={reading} />}
    />
  );
}

function alertWhat(alert: AlertEntry): string {
  return alert.foundBeforeWatch ? `${alert.what} On ESPN before the watch began.` : alert.what;
}

function AlertAction(props: { alert: AlertEntry; matched: boolean; reading: Reading }) {
  const { alert, reading } = props;
  if (alert.acknowledgedAt === null) {
    return (
      <form action={`/commish/alerts/${alert.alertId}/acknowledge`} method="post">
        <Button variant="ghost" type="submit">
          Acknowledge
        </Button>
      </form>
    );
  }
  const text = props.matched
    ? "Acknowledged automatically"
    : `Acknowledged ${when(alert.acknowledgedAt, reading)}`;
  return <span className="text-[12px] text-text-meta">{text}</span>;
}
