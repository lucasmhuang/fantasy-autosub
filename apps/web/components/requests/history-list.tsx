import Link from "next/link";
import type { TeamHistory } from "../../lib/server/request-view";
import { formatReadTime } from "./format";
import { REQUEST_STATUS_LABELS } from "./labels";

// The team's requests, newest first (H1); each opens its own page.
export function HistoryList({ history }: { history: TeamHistory }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">Your requests</h2>
      <HistoryBody history={history} />
    </section>
  );
}

function HistoryBody({ history }: { history: TeamHistory }) {
  if (history.status === "unavailable") {
    return <Muted text="Your requests can't be shown right now. Try again in a moment." />;
  }
  if (history.requests.length === 0) return <Muted text="No requests yet." />;
  return (
    <ul className="grid gap-2">
      {history.requests.map((request) => (
        <li key={request.requestId}>
          <Link
            href={`/app/requests/${request.requestId}`}
            className="flex flex-col gap-1 rounded-[1.5rem] border border-white/8 bg-black/15 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
          >
            <span>
              {request.replacementName} in for {request.injuredName}
            </span>
            <span className="text-[color:var(--muted)]">
              {REQUEST_STATUS_LABELS[request.status]} ·{" "}
              {formatReadTime(request.filedAt.toISOString())}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Muted({ text }: { text: string }) {
  return <p className="text-sm text-[color:var(--muted)]">{text}</p>;
}
