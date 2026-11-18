import { Notice } from "@injurysub/ui";
import type { TeamHistory } from "../../lib/server/request-view";
import { commissionerWord, REQUESTS_UNREAD } from "./board-copy";
import { RequestRows } from "./request-rows";

// The Requests destination: the team's requests, newest first, each opening its page.
export function RequestsListView({
  history,
  team,
  zone,
  now,
  commissionerName,
}: {
  history: TeamHistory;
  team: string | null;
  zone: string;
  now: Date;
  commissionerName: string | null;
}) {
  return (
    <div className="page single flow">
      <header className="titleblock">
        <h1 className="t-title">Your requests</h1>
        {team && <div className="titleblock-subtitle">{team}</div>}
      </header>
      {history.status === "unavailable" ? (
        <Notice tone="fail" action={{ label: "Try again", href: "/app/requests" }}>
          {REQUESTS_UNREAD}
        </Notice>
      ) : history.requests.length === 0 ? (
        <div className="list-panel px-(--space-16) py-(--space-14)">
          <p className="text-[14px] text-text-2">No requests yet.</p>
        </div>
      ) : (
        <RequestRows
          requests={history.requests}
          zone={zone}
          now={now}
          commissioner={commissionerWord(commissionerName)}
        />
      )}
    </div>
  );
}
