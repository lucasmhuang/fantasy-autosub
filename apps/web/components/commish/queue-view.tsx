import { AutomationLine, HealthPanel, Notice, QueueRow, SectionHeader } from "@injurysub/ui";
import { renderCommissionerStatus } from "../../app/(commish)/commish/status-messages";
import { faceImageProps } from "../../lib/server/images";
import type { Queue, QueueAlert, QueueRequest } from "../../lib/server/queue";
import { AddressStatusNotice } from "../board/status-notice";
import { alertRowWords, automationWords, healthWords, requestRowWords } from "./queue-copy";

type Reading = { zone: string; now: Date };
type Found = Extract<Queue, { status: "found" }>;

const FAIL =
  "Couldn't load the queue: InjurySub's database didn't answer. This isn't an empty queue.";

// The commissioner's queue: health first, then what needs them, then everything else
// (IF-QUEUE-1). One column; the detail beside it at 1280 comes with the rebuilt detail page.
export function QueueView({
  queue,
  status,
  zone,
  now,
}: {
  queue: Queue;
  status: string | undefined;
  zone: string;
  now: Date;
}) {
  return (
    <div className="page single flow">
      <header className="titleblock">
        <h1 className="t-title">Queue</h1>
      </header>
      {queue.status === "unavailable" ? (
        <Notice tone="fail" action={{ label: "Try again", href: "/commish/requests" }}>
          {FAIL}
        </Notice>
      ) : (
        <QueueBody queue={queue} status={status} reading={{ zone, now }} />
      )}
    </div>
  );
}

function QueueBody({
  queue,
  status,
  reading,
}: {
  queue: Found;
  status: string | undefined;
  reading: Reading;
}) {
  const automation = automationWords(queue.automation, reading);
  return (
    <>
      <AutomationLine on={automation.on} detail={automation.detail} action={automation.action} />
      <AddressStatusNotice status={status} render={renderCommissionerStatus} />
      {automation.notice && <Notice tone="info">{automation.notice}</Notice>}
      <HealthPanel {...healthWords(queue.health, reading)} />
      <NeedsYou rows={queue.needsYou} reading={reading} />
      {queue.rest.length > 0 && (
        <section aria-labelledby="queue-rest">
          <SectionHeader id="queue-rest">Everything else</SectionHeader>
          <div className="list-panel">
            {queue.rest.map((row) => (
              <RequestQueueRow key={row.requestId} row={row} reading={reading} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function NeedsYou({ rows, reading }: { rows: Found["needsYou"]; reading: Reading }) {
  if (rows.length === 0) {
    return (
      <section aria-labelledby="queue-needs">
        <SectionHeader id="queue-needs">Needs you</SectionHeader>
        <div className="list-panel px-(--space-16) py-(--space-14)">
          <p className="text-[14px] text-text-2">Nothing needs you.</p>
        </div>
      </section>
    );
  }
  return (
    <section aria-labelledby="queue-needs">
      <SectionHeader id="queue-needs" tone="wait">
        {`Needs you · ${rows.length}`}
      </SectionHeader>
      <div className="list-panel">
        {rows.map((row) =>
          row.kind === "alert" ? (
            <AlertQueueRow key={row.alertId} alert={row} reading={reading} />
          ) : (
            <RequestQueueRow key={row.requestId} row={row} reading={reading} />
          )
        )}
      </div>
    </section>
  );
}

function RequestQueueRow({ row, reading }: { row: QueueRequest; reading: Reading }) {
  return (
    <QueueRow
      {...requestRowWords(row, reading)}
      incoming={{ face: faceImageProps(String(row.replacement.playerId), 54) }}
      outgoing={{ face: faceImageProps(String(row.injured.playerId), 54), out: true }}
      href={`/commish/requests/${row.requestId}`}
    />
  );
}

function AlertQueueRow({ alert, reading }: { alert: QueueAlert; reading: Reading }) {
  return <QueueRow {...alertRowWords(alert, reading)} alert href="/commish/alerts" />;
}
