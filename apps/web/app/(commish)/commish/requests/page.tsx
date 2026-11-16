import { formatTenths } from "@injurysub/domain";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CommishHeader } from "../../../../components/commish/commish-header";
import { EspnStatusPanel } from "../../../../components/commish/espn-status-panel";
import { formatReadTime } from "../../../../components/requests/format";
import { ESPN_BLOCK_TEXT, REQUEST_STATUS_LABELS } from "../../../../components/requests/labels";
import { StatusNotice } from "../../../../components/requests/status-notice";
import { Shell } from "../../../../components/shell/shell";
import { Surface } from "../../../../components/shell/site-shell";
import {
  COMMISSIONER_ONLY,
  commissionerAccess,
  deviceZoneOf,
  getCurrentAuthenticatedSession,
  signInLocation,
} from "../../../../lib/server/auth";
import {
  type CommissionerQueue,
  loadCommissionerQueue,
  loadEspnStatus,
  type QueueEntry,
} from "../../../../lib/server/commish";
import { loadShell } from "../../../../lib/server/shell";
import { renderCommissionerStatus } from "../status-messages";

// Every team's requests, those needing the commissioner first (Q3), and ESPN's state (O1).
export default async function CommissionerRequestsPage(props: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await getCurrentAuthenticatedSession();
  const access = commissionerAccess(session);
  if (access === "sign_in" || session === null) redirect(signInLocation("/commish/requests"));
  if (access === "not_commissioner") redirect(COMMISSIONER_ONLY);
  const zone = deviceZoneOf(session);

  const { status } = await props.searchParams;
  const [queue, espn] = await Promise.all([loadCommissionerQueue(), loadEspnStatus()]);
  const shell = await loadShell(session);
  return (
    <Shell shell={shell} current="queue">
      <div className="page-shell">
        <div className="page-inner flex flex-col gap-6">
          <Surface className="rounded-[2rem] p-6 sm:p-8">
            <CommishHeader title="Requests" />
            <StatusNotice status={renderCommissionerStatus(status ?? null)} />
            <div className="mt-6">
              <EspnStatusPanel status={espn} zone={zone} />
            </div>
            <QueueList queue={queue} zone={zone} />
          </Surface>
        </div>
      </div>
    </Shell>
  );
}

function QueueList({ queue, zone }: { queue: CommissionerQueue; zone: string }) {
  if (queue.status === "unavailable") {
    return <Muted text="The requests can't be shown right now. Try again in a moment." />;
  }
  if (queue.requests.length === 0) return <Muted text="No requests yet." />;
  return (
    <ul className="mt-6 grid gap-3">
      {queue.requests.map((entry) => (
        <li key={entry.requestId}>
          <QueueRow entry={entry} zone={zone} />
        </li>
      ))}
    </ul>
  );
}

function QueueRow({ entry, zone }: { entry: QueueEntry; zone: string }) {
  const amount =
    entry.adjustmentTenths === null || entry.adjustmentTenths === 0
      ? "no adjustment"
      : `${formatTenths(entry.adjustmentTenths, { signed: true })} pts`;
  return (
    <Link
      href={`/commish/requests/${entry.requestId}`}
      className="flex flex-col gap-1 rounded-[1.5rem] border border-white/8 bg-black/15 p-4 text-sm"
    >
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-base font-medium">
          Team {entry.teamId}: {entry.replacementName} in for {entry.injuredName}
        </span>
        <span style={{ color: entry.needsAction ? "var(--warning)" : "var(--muted)" }}>
          {REQUEST_STATUS_LABELS[entry.status]}
        </span>
      </span>
      {entry.why === null ? null : <span>Needs you: {entry.why}.</span>}
      {entry.blocked === null ? null : <span>Blocked: {ESPN_BLOCK_TEXT[entry.blocked]}.</span>}
      <span className="text-[color:var(--muted)]">
        {formatReadTime(entry.filedAt.toISOString(), zone)} · {amount}
      </span>
    </Link>
  );
}

function Muted({ text }: { text: string }) {
  return <p className="mt-6 text-sm text-[color:var(--muted)]">{text}</p>;
}
