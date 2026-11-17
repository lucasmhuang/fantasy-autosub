import { HealthPanel, Notice, QueueRow, SectionHeader } from "@injurysub/ui";
import { renderCommissionerStatus } from "../../app/(commish)/commish/status-messages";
import { faceImageProps } from "../../lib/server/images";
import type { Queue, QueueAlert, QueueRequest } from "../../lib/server/queue";
import { AddressStatusNotice } from "../board/status-notice";
import { AutomationStrip } from "./commish-title";
import { alertRowWords, healthWords, requestRowWords } from "./queue-copy";

type Reading = { zone: string; now: Date; current?: string };
type Found = Extract<Queue, { status: "found" }>;

const FAIL =
  "Couldn't load the queue: InjurySub's database didn't answer. This isn't an empty queue.";

type QueueProps = {
  queue: Queue;
  status: string | undefined;
  zone: string;
  now: Date;
  // The request open beside the queue at 1280 (FS-LAYOUT-5).
  current?: string;
  // Beside a request, the request's own automation line is the page's (Revision 4, A).
  strip?: boolean;
};

// The commissioner's queue: health first, then what needs them, then everything else
// (IF-QUEUE-1).
export function QueueView(props: QueueProps) {
  return (
    <div className="page single flow">
      <QueueColumn {...props} />
    </div>
  );
}

// The queue's own column, which the request detail puts beside itself at 1280.
export function QueueColumn({ queue, status, zone, now, current, strip = true }: QueueProps) {
  const automation =
    queue.status === "found" ? queue.automation : { status: "unavailable" as const };
  return (
    <>
      <header className="titleblock">
        <h1 className="t-title">Queue</h1>
      </header>
      {strip && (
        <AutomationStrip automation={automation} from="/commish/requests" zone={zone} now={now} />
      )}
      {queue.status === "unavailable" ? (
        <Notice tone="fail" action={{ label: "Try again", href: "/commish/requests" }}>
          {FAIL}
        </Notice>
      ) : (
        <QueueBody queue={queue} status={status} reading={{ zone, now, current }} />
      )}
    </>
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
  return (
    <>
      <AddressStatusNotice status={status} render={renderCommissionerStatus} />
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
      current={row.requestId === reading.current}
    />
  );
}

function AlertQueueRow({ alert, reading }: { alert: QueueAlert; reading: Reading }) {
  return <QueueRow {...alertRowWords(alert, reading)} alert href="/commish/alerts" />;
}
